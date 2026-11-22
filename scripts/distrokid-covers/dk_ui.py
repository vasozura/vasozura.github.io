"""DistroKid release helper (local UI).

DistroKid has no public API and its Terms forbid scripts/bots on the site,
so this program does NOT log in or upload. It prepares everything so the
owner fills the DistroKid form by hand in about two minutes:
  - checks and converts the audio (WAV 16-bit / 44.1 kHz, stereo)
  - checks and converts the cover (3000x3000 JPG)
  - keeps the metadata, lyrics (cleaned of [tags]) and AI-disclosure answers
  - shows every field in DistroKid's order with a Copy button
  - tracks status: draft -> ready -> uploaded -> live

Run: DISTROKID_UI.bat  (opens http://127.0.0.1:8766)
Stdlib only + ffmpeg/ffprobe.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import webbrowser
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import yt_alexandria as yta  # noqa: E402
import dk_covers  # local Maestro/WanGP artwork worker
DATA = Path(os.environ.get("DK_DATA", r"D:\Prog\MusicToVideo\Library\_agent\distrokid"))
REL = DATA / "releases"
PORT = int(os.environ.get("DK_PORT", "8766"))
LOGO = HERE / "za_logo_round.png"   # owner prefers the round logo (za_logo.png = flat variant)
HOME = Path(os.environ.get("USERPROFILE", str(Path.home())))
SEARCH_DIRS = [Path(p) for p in os.environ.get("DK_SEARCH", "").split(";") if p] or [
    Path(r"D:\ComposerArchive\00_INBOX\NEEDS_REVIEW"), DATA / "wav", HOME / "Downloads", Path(r"D:\Suno"),
]

DEFAULTS = {
    "artist": "Zura Alexandria",
    "songwriter_real_name": "VASSILI ZURASHVILI",   # as on the existing DistroKid releases
    "language": "Georgian",
    "genre": "Singer/Songwriter",
    "genre2": "World",
    "explicit": "No",
    "ai_music": "Yes - the arrangement and vocal performance were generated with Suno (paid Premier plan)",
    "ai_melody": "No - the melody was written by the artist",
    "ai_lyrics": "No - the lyrics are a poem by the credited poet",
    "status": "draft",
    "instruments": "AI",
}

FIELDS = [  # order of the DistroKid upload form
    ("artist", "არტისტი"),
    ("dk_title", "სიმღერის სათაური — ქართული (English)"),
    ("release_date", "გამოშვების თარიღი"),
    ("language", "ენა"),
    ("genre", "ძირითადი ჟანრი"),
    ("genre2", "მეორე ჟანრი"),
    ("songwriter_real_name", "კომპოზიტორი (ნამდვილი სახელი)"),
    ("lyricist_en", "Lyrics — პოეტი ლათინურად"),
    ("songwriter_real_name", "Other instrument / Producer"),
    ("instruments", "Instruments"),
    ("explicit", "Explicit"),
    ("ai_music", "AI: მუსიკა / არანჟირება"),
    ("ai_melody", "AI: მელოდია"),
    ("ai_lyrics", "AI: ტექსტი"),
    ("lyrics", "ტექსტი (ტეგების გარეშე)"),
]


# ---------------------------------------------------------------- tools
def tool(name: str) -> str:
    for c in (shutil.which(name), rf"C:\ffmpeg\bin\{name}.exe", rf"D:\Prog\ffmpeg\bin\{name}.exe"):
        if c and Path(c).exists():
            return c
    return name


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def probe(path: str) -> dict:
    r = run([tool("ffprobe"), "-v", "error", "-show_streams", "-show_format", "-of", "json", path])
    try:
        return json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        return {}


def check_audio(path: str) -> dict:
    p = Path(path)
    if not path or not p.exists():
        return {"ok": False, "msg": "აუდიო ფაილი ვერ მოიძებნა"}
    info = probe(path)
    a = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not a:
        return {"ok": False, "msg": "ფაილში აუდიო არ არის"}
    sr = int(a.get("sample_rate") or 0)
    ch = int(a.get("channels") or 0)
    codec = a.get("codec_name", "")
    bits = a.get("bits_per_sample") or a.get("bits_per_raw_sample") or 0
    dur = float(info.get("format", {}).get("duration") or 0)
    problems = []
    note = ""
    if not codec.startswith("pcm"):
        if codec == "mp3":
            note = " — MP3-ს DistroKid იღებს (WAV ჯობია, თუ გაქვს)"
        else:
            problems.append(f"ფორმატი {codec} (WAV ან MP3 საჭიროა)")
    if sr < 44100:
        problems.append(f"sample rate {sr} (საჭიროა 44100+)")
    if ch != 2:
        problems.append(f"არხები: {ch} (საჭიროა სტერეო)")
    if codec.startswith("pcm") and int(bits) not in (16, 24, 32):
        problems.append(f"bit depth {bits}")
    desc = f"{codec}, {sr} Hz, {ch} ch, {bits or '?'} bit, {int(dur // 60)}:{int(dur % 60):02d}"
    return {"ok": not problems, "msg": desc + ("" if not problems else " — " + "; ".join(problems)) + (note if not problems else ""), "duration": dur}


def check_cover(path: str) -> dict:
    p = Path(path)
    if not path or not p.exists():
        return {"ok": False, "msg": "ყდა ვერ მოიძებნა"}
    info = probe(path)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        return {"ok": False, "msg": "სურათი ვერ წავიკითხე"}
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    problems = []
    if w != h:
        problems.append("არ არის კვადრატი")
    if min(w, h) < 3000:
        problems.append("3000x3000-ზე პატარაა")
    if p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
        problems.append("JPG/PNG უნდა იყოს")
    return {"ok": not problems, "msg": f"{w}x{h} {p.suffix.lower()}" + ("" if not problems else " — " + "; ".join(problems))}


def slugify(s: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE).strip("_")
    return s[:60] or datetime.now().strftime("rel_%Y%m%d_%H%M%S")


def clean_lyrics(text: str) -> str:
    lines = []
    for ln in (text or "").replace("\r", "").split("\n"):
        ln = re.sub(r"\[[^\]]*\]|\([^)]*(verse|chorus|intro|outro|bridge|instrumental)[^)]*\)", "", ln, flags=re.I).strip()
        lines.append(ln)
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return out


# ---------------------------------------------------------------- store
def rel_path(rid: str) -> Path:
    return REL / f"{rid}.json"


def load_all() -> list[dict]:
    REL.mkdir(parents=True, exist_ok=True)
    out = []
    for f in sorted(REL.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            d["id"] = f.stem
            out.append(d)
        except Exception:
            pass
    out.sort(key=lambda d: d.get("updated", ""), reverse=True)
    return out


def save(d: dict) -> dict:
    REL.mkdir(parents=True, exist_ok=True)
    rid = d.get("id") or slugify(d.get("title_en") or d.get("title") or "")
    if not d.get("id") and rel_path(rid).exists():
        rid += datetime.now().strftime("_%H%M%S")
    d["id"] = rid
    for k, v in DEFAULTS.items():
        d.setdefault(k, v)
    d["lyrics"] = clean_lyrics(d.get("lyrics", ""))
    t, te = d.get("title", "").strip(), d.get("title_en", "").strip()
    d["dk_title"] = f"{t} ({te})" if t and te else t
    d["audio_check"] = check_audio(d.get("audio", ""))
    d["cover_check"] = check_cover(d.get("cover", ""))
    if d.get("status") in ("draft", "ready"):
        d["status"] = "ready" if (d["audio_check"]["ok"] and d["cover_check"]["ok"] and d.get("title") and d.get("lyricist")) else "draft"
    d["updated"] = datetime.now().isoformat(timespec="seconds")
    rel_path(rid).write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return d


def fix_audio(d: dict) -> dict:
    src = d.get("audio", "")
    out = DATA / "wav" / f"{d['id']}__distrokid.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    r = run([tool("ffmpeg"), "-y", "-v", "error", "-i", src, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(out)])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])
    d["audio_original"] = d.get("audio_original") or src
    d["audio"] = str(out)
    return save(d)


def fix_cover(d: dict) -> dict:
    """Square 3000x3000 JPG with the Zura Alexandria logo in the top-left corner."""
    cov = d.get("cover", "")
    src = d.get("cover_original") if cov.endswith("__3000.jpg") and d.get("cover_original") else cov
    out = DATA / "covers" / f"{d['id']}__3000.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    base = "[0:v]crop='min(iw,ih)':'min(iw,ih)',scale=3000:3000:flags=lanczos,format=rgba[bg]"
    if d.get("logo", True) and LOGO.exists():
        fc = (base + ";[1:v]scale=480:-1,split[l][s];"
              "[s]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.6,boxblur=10:2[sh];"
              "[bg][sh]overlay=100:104[t];[t][l]overlay=90:90,format=yuv420p")
        cmd = [tool("ffmpeg"), "-y", "-v", "error", "-i", src, "-i", str(LOGO), "-filter_complex", fc]
    else:
        cmd = [tool("ffmpeg"), "-y", "-v", "error", "-i", src, "-filter_complex", base + ";[bg]format=yuv420p"]
    r = run(cmd + ["-q:v", "2", "-frames:v", "1", str(out)])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])
    d["cover_original"] = src
    d["cover"] = str(out)
    return save(d)


def norm(t: str) -> str:
    t = re.sub(r"^\d{6,}-", "", t)                 # archive id prefix
    t = re.sub(r"\(\d+\)|\(remastered\)", "", t, flags=re.I)
    return re.sub(r"[\W_]+", "", t.lower(), flags=re.UNICODE)


def find_files(title: str) -> dict:
    """MP3 / WAV / lyrics .txt whose file name contains the song title."""
    key = norm(title.split("(")[0])
    res = {"mp3": [], "wav": [], "txt": [], "img": []}
    if len(key) < 3:
        return res
    for root in SEARCH_DIRS:
        if not root.exists():
            continue
        for f in root.rglob("*"):
            ext = f.suffix.lower().lstrip(".")
            kind = {"mp3": "mp3", "wav": "wav", "txt": "txt"}.get(ext)
            if not kind or not f.is_file() or key not in norm(f.stem):
                continue
            item = {"path": str(f), "name": f.name, "mtime": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="minutes")}
            if kind in ("mp3", "wav"):
                dur = float(probe(str(f)).get("format", {}).get("duration") or 0)
                item["dur"] = round(dur, 1)
            res[kind].append(item)
    for k in res:
        res[k].sort(key=lambda x: x["mtime"], reverse=True)
    return res


def newest_download_image() -> str:
    dl = HOME / "Downloads"
    imgs = [f for f in dl.glob("*") if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]
    return str(max(imgs, key=lambda f: f.stat().st_mtime)) if imgs else ""


COVER_STYLES = {
    "quartet": "Four handsome men in black tuxedos with bow ties (a vocal quartet), singing together with open, expressive gestures, in the foreground",
    "solo_woman": "A beautiful Georgian woman in a traditional Georgian dress (chokha-style, rich embroidery), singing or playing an instrument (accordion, panduri or guitar)",
    "solo_man": "A Georgian man in a traditional chokha, singing or playing a panduri",
    "scene": "No people in focus - a poetic scene that carries the song's main symbol",
}


def cover_prompt(d: dict) -> str:
    """Prompt in the style of the existing Zura Alexandria covers on Spotify."""
    title = d.get("title", "")
    title_en = d.get("title_en", "")
    lyr = (d.get("lyrics") or "").strip()
    georgian = bool(re.search(r"[\u10D0-\u10FF]", title))
    style = d.get("cover_style") or ("quartet" if georgian else "poetic")
    if style == "poetic":   # non-Georgian songs: "The Life We Never Lived" look
        return (
            f'Create a square 1:1 album cover (3000x3000 px) for the song "{title_en or title}" by Zura Alexandria.\n\n'
            "Style: surreal, symbolic cinematic poetry - Terrence Malick + Denis Villeneuve + Studio Ghibli + Moebius, dream realism. "
            "Dark night-blue world lit by warm golden light: amber, gold, night sky, rain, fog, light rays, dust, water. "
            "Melancholic, hopeful, timeless.\n"
            "Composition: ONE strong central symbol taken from the lyrics below (e.g. a lighthouse, an hourglass, a lone figure on a wet road, "
            "a glowing heart, a door of light) - simple enough to read as a small thumbnail.\n"
            f'Title: write exactly "{title_en or title}" in an elegant thin serif, pale gold, small, at the BOTTOM centre. No other text.\n'
            "Leave the TOP-LEFT corner free and dark (about 20% of the width) - the round Zura Alexandria logo will be placed there afterwards. "
            "No logo, watermark or extra letters.\n\n"
            f"Lyrics:\n{lyr}"
        )
    who = COVER_STYLES.get(style, COVER_STYLES["quartet"])
    return (
        f'Create a square 1:1 album cover (3000x3000 px) for the Georgian song "{title}"' + (f" ({title_en})" if title_en else "") + " by Zura Alexandria.\n\n"
        "Keep the same style as the artist's previous covers: a vivid, richly detailed, warm cinematic digital painting; "
        "golden-hour / sunset light; a Georgian setting (Caucasus mountains, old stone bridge, church or tower, vineyards, river); "
        "flowers and roses or pomegranates framing the edges; saturated, joyful colours.\n"
        f"Main subject: {who}. Take the mood, place and symbols from the lyrics below.\n"
        f'Title: write exactly "{title}" in large, ornate, decorative Georgian lettering (white with a red/gold outline) in the TOP-RIGHT area. '
        "Copy every Georgian letter exactly as given - no other text anywhere.\n"
        "Leave the TOP-LEFT corner free (about 20% of the width) - the round Zura Alexandria logo will be placed there afterwards. "
        "No logo, watermark or extra letters.\n\n"
        f"Lyrics (Georgian):\n{lyr}"
    )


ARCHIVE_SONGS = Path(os.environ.get("DK_ARCHIVE", r"D:\ComposerArchive\01_LIBRARY\songs"))
POETS_FILE = HERE.parent / "slides_poets.json"


def _known_poets() -> dict:
    """{georgian name: {"en": latin name, "match": [variants]}} from YT_Upload\\slides_poets.json."""
    try:
        d = json.loads(POETS_FILE.read_text(encoding="utf-8"))
        return {k: v for k, v in d.items() if not k.startswith("_") and isinstance(v, dict)}
    except Exception:
        return {}


def _poet_of(text: str, poets: dict) -> str:
    t = norm(text)
    for name, v in poets.items():
        for m in [name] + list(v.get("match") or []) + [v.get("en") or ""]:
            nm = norm(m)
            if len(nm) >= 6 and (t == nm or (nm in t and len(t) - len(nm) <= 4)):
                return name
    return ""


def _split_title(raw: str, poets: dict) -> tuple[str, str]:
    """-> (title, poet). Handles 'poet - title', 'title - poet', 'Title-Based on the Poem by X'."""
    raw = re.sub(r"\s*\((remastered|remaster|v\d+)\)\s*$", "", raw.strip(), flags=re.I)
    m = re.match(r"(.+?)\s*[-—–]?\s*based on the poem by\s+(.+)$", raw, flags=re.I)
    if m:
        return m.group(1).strip(" -"), _poet_of(m.group(2), poets) or m.group(2).strip()
    parts = [x.strip() for x in re.split(r"\s+[-—–]\s+|\s+[-—–]|[-—–]\s+", raw) if x.strip()]
    if len(parts) < 2:
        return raw, ""
    for k, part in enumerate(parts):
        p = _poet_of(part, poets)
        if p:
            return " - ".join(parts[:k] + parts[k + 1:]), p
    looks_name = lambda x: len(x.split()) in (2, 3) and not re.search(r"[?!,.:…]", x)
    a, b = parts[0], " - ".join(parts[1:])
    if looks_name(a) and not looks_name(b):
        return b, a
    if looks_name(parts[-1]) and not looks_name(" - ".join(parts[:-1])):
        return " - ".join(parts[:-1]), parts[-1]
    return a, b


def released_keys() -> set:
    keys = set()
    try:
        for r in json.loads((DATA / "released.json").read_text(encoding="utf-8")).get("releases", []):
            keys.add(norm(r["title"].split("(")[0]))
    except Exception:
        pass
    for d in load_all():
        if d.get("status") in ("uploaded", "live"):
            keys.add(norm((d.get("title") or "").split("(")[0]))
    return keys


def _skipped() -> set:
    try:
        return set(json.loads((DATA / "skipped.json").read_text(encoding="utf-8")))
    except Exception:
        return set()


ALLOWED_AUDIO: set = set()   # files the page may play (filled by suggestions/load_all)


def _nc(x) -> str:
    return os.path.normcase(os.path.abspath(str(x)))


def suggestions() -> dict:
    """Songs in the Composer Archive that are not on DistroKid yet, best candidates first."""
    poets = _known_poets()
    done = released_keys()
    drafts = {norm((d.get("title") or "").split("(")[0]) for d in load_all()}
    skipped = _skipped()
    groups: dict[str, dict] = {}
    if ARCHIVE_SONGS.exists():
        for folder in ARCHIVE_SONGS.iterdir():
            mf = folder / "metadata.json"
            if not mf.exists():
                continue
            try:
                song = json.loads(mf.read_text(encoding="utf-8")).get("song", {})
            except Exception:
                continue
            title, poet = _split_title(song.get("title") or folder.name, poets)
            key = norm(title)
            if len(key) < 2 or key in done:
                continue
            aud = folder / "audio"
            files = [f for f in aud.iterdir()] if aud.exists() else []
            wav = next((str(f) for f in files if f.suffix.lower() == ".wav"), "")
            mp3 = next((str(f) for f in files if f.suffix.lower() == ".mp3"), "")
            lyr = folder / "lyrics" / "ka.txt"
            if not lyr.exists():
                lyr = next(iter((folder / "lyrics").glob("*.txt")), None) if (folder / "lyrics").exists() else None
            cov = next(iter((folder / "cover").glob("*")), None) if (folder / "cover").exists() else None
            pub = song.get("publication_state") or ""
            score = (3 if pub == "WEB_PUBLISHED" else 0) + (2 if wav else 0) + (1 if lyr else 0) + (1 if poet else 0)
            item = {"key": key, "title": title, "poet": poet, "poet_en": (poets.get(poet) or {}).get("en", ""), "wav": wav, "mp3": mp3,
                    "lyrics": str(lyr) if lyr else "", "cover": str(cov) if cov else "",
                    "suno": song.get("suno_url") or "", "published": pub == "WEB_PUBLISHED",
                    "duration": song.get("duration_seconds"), "folder": folder.name, "score": score,
                    "draft": key in drafts}
            ver = {k: item[k] for k in ("folder", "wav", "mp3", "lyrics", "suno", "published", "duration", "score")}
            g = groups.get(key)
            if g is None:
                item["all"] = [ver]
                groups[key] = item
            else:
                g["all"].append(ver)
                if score > g["score"]:
                    item["all"] = g["all"]
                    groups[key] = item
    for g in groups.values():
        for v in g["all"]:
            for f in (v.get("wav"), v.get("mp3")):
                if f:
                    ALLOWED_AUDIO.add(_nc(f))
        g["all"].sort(key=lambda v: (-v["score"], v["folder"]))
        g["versions"] = len(g["all"])
    items = [g for k, g in groups.items() if k not in skipped]
    items.sort(key=lambda x: (-x["score"], x["title"]))
    return {"items": items, "released": len(done), "skipped": len(skipped)}


def start_from_suggestion(it: dict) -> dict:
    ch = it.get("chosen")
    if ch:                       # the version the owner picked after listening
        it = {**it, **ch}
    lyr = ""
    if it.get("lyrics") and Path(it["lyrics"]).exists():
        lyr = Path(it["lyrics"]).read_text(encoding="utf-8", errors="replace")
    d = {"title": it.get("title", ""), "lyricist": it.get("poet", ""), "lyricist_en": it.get("poet_en", ""), "lyrics": lyr,
         "audio": it.get("wav") or it.get("mp3") or "", "mp3": it.get("mp3", ""),
         "cover": "", "archive_folder": it.get("folder", ""), "suno_url": it.get("suno", ""),
         "needs_cover": True}      # the night cover batch picks these up
    return save(d)


def skip_suggestion(key: str) -> dict:
    sk = _skipped()
    sk.add(key)
    (DATA / "skipped.json").write_text(json.dumps(sorted(sk), ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


def import_queue() -> int:
    """Pick up songs that the Suno intake put in queue.json."""
    q = DATA / "queue.json"
    if not q.exists():
        return 0
    try:
        items = json.loads(q.read_text(encoding="utf-8"))
    except Exception:
        return 0
    if isinstance(items, dict):
        items = items.get("items", [])
    have = {d.get("suno_id") for d in load_all()}
    n = 0
    for it in items:
        sid = it.get("suno_id") or it.get("id")
        if not sid or sid in have:
            continue
        save({
            "suno_id": sid, "title": it.get("title", ""), "lyricist": it.get("poet", ""),
            "lyrics": it.get("lyrics", ""), "audio": it.get("wav") or it.get("audio", ""),
            "cover": it.get("cover", ""), "release_date": "",
        })
        n += 1
    return n


# ---------------------------------------------------------------- http
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def send(self, code: int, body, ctype="application/json; charset=utf-8"):
        b = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/":
            return self.send(200, (HERE / "dk_ui.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/covers/status":
            from urllib.parse import parse_qs
            try:
                return self.send(200, dk_covers.status(parse_qs(u.query).get("id", [""])[0]))
            except ValueError as error:
                return self.send(400, {"error": str(error)})
        if u.path == "/cover-candidate":
            from urllib.parse import parse_qs
            try:
                q = parse_qs(u.query)
                fp = dk_covers.image_path(q.get("id", [""])[0], q.get("n", ["0"])[0])
                return self.send(200, fp.read_bytes(), "image/jpeg")
            except (ValueError, FileNotFoundError):
                return self.send(404, {"error": "Candidate not found"})
        if u.path == "/audio":
            from urllib.parse import parse_qs
            fp = Path(parse_qs(u.query).get("p", [""])[0])
            roots = [ARCHIVE_SONGS, DATA] + SEARCH_DIRS
            rel_audio = {_nc(d.get(k)) for d in load_all() for k in ("audio", "mp3") if d.get(k)}
            ok = fp.suffix.lower() in (".mp3", ".wav", ".m4a", ".flac") and fp.is_file() and (
                _nc(fp) in ALLOWED_AUDIO or _nc(fp) in rel_audio
                or any(_nc(fp).startswith(_nc(r) + os.sep) for r in roots))
            if not ok:
                return self.send(404, {"error": "not found"})
            size = fp.stat().st_size
            start, end = 0, size - 1
            rng = self.headers.get("Range")
            m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
            if m:
                start = int(m.group(1) or 0)
                end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            self.send_response(206 if m else 200)
            self.send_header("Content-Type", "audio/wav" if fp.suffix.lower() == ".wav" else "audio/mpeg")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if m:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with open(fp, "rb") as f:
                f.seek(start)
                left = end - start + 1
                try:
                    while left > 0:
                        chunk = f.read(min(262144, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            return
        if u.path == "/api/yt/list":
            return self.send(200, {"videos": yta.list_videos(), "job": yta.JOB})
        if u.path == "/api/yt/job":
            return self.send(200, yta.JOB)
        if u.path == "/api/list":
            return self.send(200, {"releases": load_all(), "fields": FIELDS, "defaults": DEFAULTS, "data": str(DATA)})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        try:
            d = self.body()
            if u.path == "/api/covers/start":
                return self.send(200, dk_covers.start(dk_covers.release_id(d.get("id", ""))))
            if u.path == "/api/covers/choose":
                rid = dk_covers.release_id(d.get("id", ""))
                fp = dk_covers.image_path(rid, d.get("n", 0))
                if not fp.is_file():
                    raise ValueError("Candidate not found")
                current = json.loads(rel_path(rid).read_text(encoding="utf-8"))
                current["cover"] = str(fp)
                current["cover_original"] = str(fp)
                return self.send(200, save(current))
            if u.path == "/api/save":
                return self.send(200, save(d))
            if u.path == "/api/fix_audio":
                return self.send(200, fix_audio(d))
            if u.path == "/api/fix_cover":
                return self.send(200, fix_cover(d))
            if u.path == "/api/yt/meta":
                return self.send(200, yta.default_meta(d.get("title", ""), d.get("poet", "")))
            if u.path == "/api/yt/upload":
                r = yta.start_upload(d)
                return self.send(200 if r.get("ok") else 400, r)
            if u.path == "/api/restart":   # lets Claude/the page load new code without closing windows
                import threading
                def _re():
                    time.sleep(0.5)
                    subprocess.Popen([sys.executable] + sys.argv, cwd=str(HERE),
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    os._exit(0)
                threading.Thread(target=_re, daemon=True).start()
                return self.send(200, {"ok": True})
            if u.path == "/api/suggest":
                return self.send(200, suggestions())
            if u.path == "/api/suggest/start":
                return self.send(200, start_from_suggestion(d))
            if u.path == "/api/suggest/start_many":
                out = []
                for it in d.get("items", []):
                    r = start_from_suggestion(it)
                    out.append(r["id"])
                return self.send(200, {"ids": out})
            if u.path == "/api/suggest/skip":
                return self.send(200, skip_suggestion(d.get("key", "")))
            if u.path == "/api/find":
                return self.send(200, find_files(d.get("title", "")))
            if u.path == "/api/read_txt":
                return self.send(200, {"text": clean_lyrics(Path(d["path"]).read_text(encoding="utf-8", errors="replace"))})
            if u.path == "/api/cover_prompt":
                return self.send(200, {"text": cover_prompt(d)})
            if u.path == "/api/newest_image":
                return self.send(200, {"path": newest_download_image()})
            if u.path == "/api/open_url":
                if d.get("url", "").startswith(("https://chatgpt.com", "https://distrokid.com", "https://suno.com")):
                    webbrowser.open(d["url"])
                return self.send(200, {"ok": True})
            if u.path == "/api/import_queue":
                return self.send(200, {"added": import_queue()})
            if u.path == "/api/open_folder":
                p = Path(d.get("path", ""))
                target = p.parent if p.is_file() else p
                if sys.platform == "win32" and target.exists():
                    if p.is_file():
                        subprocess.Popen(["explorer", "/select,", str(p)])
                    else:
                        os.startfile(str(target))  # type: ignore[attr-defined]
                return self.send(200, {"ok": True})
            if u.path == "/api/open_distrokid":
                webbrowser.open("https://distrokid.com/new/")
                return self.send(200, {"ok": True})
            if u.path == "/api/delete":
                f = rel_path(d["id"])
                arch = REL / "_archive"
                arch.mkdir(exist_ok=True)
                if f.exists():
                    f.replace(arch / f.name)   # never really deleted
                return self.send(200, {"ok": True})
        except Exception as e:  # show the error in the UI
            return self.send(400, {"error": str(e)})
        self.send(404, {"error": "not found"})


VASADZE_PORT = 8750


def start_vasadze_panel():
    """Zura Vasadze tab = the existing slides_ui.py, started in the background on a fixed port."""
    import socket
    with socket.socket() as so:
        if so.connect_ex(("127.0.0.1", VASADZE_PORT)) == 0:
            return
    ui = HERE.parent / "slides_ui.py"
    if ui.exists():
        subprocess.Popen([sys.executable, str(ui), "--port", str(VASADZE_PORT), "--no-browser"], cwd=str(ui.parent),
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def main():
    REL.mkdir(parents=True, exist_ok=True)
    yta.init(DATA)
    if "--no-vasadze" not in sys.argv:
        start_vasadze_panel()
    srv = None
    for _ in range(40):                    # after a restart the old process may still hold the port
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
            break
        except OSError:
            time.sleep(0.25)
    if srv is None:
        raise SystemExit(f"port {PORT} is busy")
    url = f"http://127.0.0.1:{PORT}"
    print(f"DistroKid helper: {url}   (data: {DATA})")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
