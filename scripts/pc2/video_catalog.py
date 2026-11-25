"""Read-only PC2 video inventory. Run nightly with Python 3.13 and ffprobe."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import csv
from datetime import datetime, time, timedelta, timezone
from fractions import Fraction
from itertools import islice
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import time as clock


ROOTS = [Path(f"{drive}:/") for drive in "DEFHIV"]
EXTENSIONS = set("mp4 mkv avi mov wmv m4v webm ts mpg mpeg flv 3gp vob".split())
SKIP_DIRS = {"$recycle.bin", "system volume information", "windows", "node_modules", ".git"}
CSV_FIELDS = ("path", "drive", "top_folder", "size", "mtime", "duration",
              "width", "height", "fps", "codec")


def inventory(root, cutoff, issues):
    pending = [root]
    while pending and clock.monotonic() < cutoff:
        directory = pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    if clock.monotonic() >= cutoff:
                        return
                    try:
                        if entry.is_symlink() or entry.is_junction():
                            issues["links_skipped"] += 1
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            name = entry.name.casefold()
                            if name in SKIP_DIRS:
                                continue
                            if directory == root / "pinokio" and name in {"bin", "cache"}:
                                continue
                            pending.append(Path(entry.path))
                        elif Path(entry.name).suffix.lower().lstrip(".") in EXTENSIONS:
                            info = entry.stat(follow_symlinks=False)
                            if stat.S_ISREG(info.st_mode):
                                path = Path(entry.path)
                                relative = path.relative_to(root)
                                top = relative.parts[0] if len(relative.parts) > 1 else "(root)"
                                yield (str(path), root.drive or str(root), top,
                                       info.st_size, info.st_mtime_ns)
                    except OSError:
                        issues["entries_unreadable"] += 1
        except OSError:
            issues["directories_unreadable"] += 1


def number(value):
    try:
        result = float(Fraction(value))
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, TypeError, ZeroDivisionError, OverflowError):
        return None


def probe(executable, record, cutoff):
    timeout = min(8, cutoff - clock.monotonic())
    if timeout <= 0:
        return None
    try:
        result = subprocess.run(
            [executable, "-v", "error", "-select_streams", "V:0",
             "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,codec_name,duration:"
             "format=duration:format_tags=comment:stream_tags=comment", "-of", "json",
             "-i", record[0]],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        payload = json.loads(result.stdout.decode("utf-8", errors="replace"))
    except subprocess.TimeoutExpired:
        if clock.monotonic() >= cutoff:
            return None
        return (*record, None, None, None, None, None, 0, "timeout")
    except (OSError, subprocess.CalledProcessError, ValueError):
        return (*record, None, None, None, None, None, 0, "probe_error")
    stream = next(iter(payload.get("streams", [])), {})
    container = payload.get("format", {})
    duration = number(stream.get("duration")) or number(container.get("duration"))
    width, height = stream.get("width"), stream.get("height")
    fps = number(stream.get("avg_frame_rate")) or number(stream.get("r_frame_rate"))
    wan = False
    if (record[0].lower().endswith(".mp4") and duration and 4 <= duration <= 6
            and (width, height) in {(832, 480), (480, 832)}):
        for source in (container, stream):
            comment = next((value for key, value in source.get("tags", {}).items()
                            if key.casefold() == "comment"), "")
            try:
                settings = json.loads(comment)
            except (ValueError, TypeError):
                continue
            if isinstance(settings, dict) and {"prompt", "seed", "model_type"} <= settings.keys():
                wan = True
                break
    return (*record, duration, width, height, fps, stream.get("codec_name"),
            int(wan), "ok" if stream else "no_video_stream")


def scan(db, roots, executable, workers, cutoff, run, issues):
    statement = """INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET drive=excluded.drive, top_folder=excluded.top_folder,
                   size=excluded.size, mtime_ns=excluded.mtime_ns, duration=excluded.duration,
                   width=excluded.width, height=excluded.height, fps=excluded.fps, codec=excluded.codec,
                   wan=excluded.wan, status=excluded.status, seen=excluded.seen"""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for root in roots:
            files = inventory(root, cutoff, issues)
            while clock.monotonic() < cutoff and (batch := list(islice(files, workers * 4))):
                pending = []
                with db:
                    for record in batch:
                        cached = db.execute("SELECT size, mtime_ns FROM videos WHERE path=?",
                                            (record[0],)).fetchone()
                        if cached == record[3:5]:
                            db.execute("UPDATE videos SET seen=? WHERE path=?", (run, record[0]))
                        else:
                            pending.append(pool.submit(probe, executable, record, cutoff))
                    for future in pending:
                        result = future.result()
                        if result is not None:
                            db.execute(statement, (*result, run))
            files.close()
            if clock.monotonic() >= cutoff:
                return False
    return True


def export(db, output, run, cutoff, issues):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    destination = output / "videos.csv"
    if destination.exists():
        destination = output / f"videos-{stamp}.csv"
    groups = defaultdict(lambda: [0, 0])
    histogram, candidates, statuses = Counter(), Counter(), Counter()
    with tempfile.NamedTemporaryFile(mode="w", newline="", encoding="utf-8-sig",
                                     dir=output, prefix="snapshot-", suffix=".partial",
                                     delete=False) as handle:
        temporary = Path(handle.name)
        writer = csv.writer(handle)
        writer.writerow(CSV_FIELDS)
        rows = db.execute("""SELECT path, drive, top_folder, size, mtime_ns, duration,
                             width, height, fps, codec, wan, status
                             FROM videos WHERE seen=? ORDER BY drive, top_folder, path""", (run,))
        for path, drive, top, size, mtime, duration, width, height, fps, codec, wan, status in rows:
            if clock.monotonic() >= cutoff:
                return False
            iso_mtime = datetime.fromtimestamp(mtime / 1e9, timezone.utc).isoformat()
            writer.writerow((path, drive, top, size, iso_mtime, duration, width, height, fps, codec))
            for key in ((drive, ""), (drive, top)):
                groups[key][0] += 1
                groups[key][1] += size
            bucket = ("unknown" if duration is None else "<4" if duration < 4
                      else "4–6" if duration <= 6 else ">6–30" if duration <= 30
                      else ">30–300" if duration <= 300 else ">300")
            histogram[bucket] += 1
            statuses[status] += 1
            if wan:
                candidates[str(Path(path).parent)] += 1
    # Creating the final name as a hard link fails if a prior export already owns it.
    os.link(temporary, destination)
    temporary.unlink()
    report = {"csv": destination.name, "issues": issues, "probe_status": statuses,
              "groups": [[*key, *value] for key, value in sorted(groups.items())],
              "duration_seconds": histogram, "wan_folders": candidates.most_common(5)}
    with (output / f"report-{stamp}.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"Catalog complete: {sum(histogram.values())} rows", flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, action="append", help="Override archive roots")
    parser.add_argument("--output", type=Path, default=Path("D:/ZuraCatalog"))
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=4)
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    now = datetime.now()
    morning_cutoff = datetime.combine(now.date(), time(6, 30))
    if morning_cutoff <= now < datetime.combine(now.date(), time(22)):
        print("Outside the nightly window (22:00–06:30).")
        return 2
    if now >= morning_cutoff:
        morning_cutoff += timedelta(days=1)
    cutoff = clock.monotonic() + (morning_cutoff - now).total_seconds() - 10
    executable = shutil.which(args.ffprobe)
    if executable is None:
        parser.error("ffprobe is unavailable")
    roots = [root.absolute() for root in (args.root or ROOTS)]
    missing = [root for root in roots if not root.is_dir()]
    if missing:
        parser.error(f"archive roots unavailable: {missing}")
    args.output.mkdir(parents=True, exist_ok=True)
    issues = Counter()
    run = clock.time_ns()
    with closing(sqlite3.connect(args.output / "cache.sqlite3")) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS videos (
                   path TEXT PRIMARY KEY, drive TEXT, top_folder TEXT, size INTEGER,
                   mtime_ns INTEGER, duration REAL, width INTEGER, height INTEGER, fps REAL,
                   codec TEXT, wan INTEGER, status TEXT, seen INTEGER)""")
        complete = scan(db, roots, executable, args.workers, cutoff, run, issues)
        if complete and export(db, args.output, run, cutoff, issues):
            return 0
    print("Nightly cutoff reached. Cached probes are ready for the next run.", flush=True)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
