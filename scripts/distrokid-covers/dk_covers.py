"""Local cover preparation through installed Maestro/WanGP. Never uploads media."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get('DK_DATA', r'D:\Prog\MusicToVideo\Library\_agent\distrokid'))
MAESTRO = Path(os.environ.get('DK_MAESTRO', r'D:\pinokio\api\Maestro.git\app'))
PYTHON = MAESTRO / 'env-rtx50/Scripts/python.exe'
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def release_id(value):
    if not value or value in ('.', '..') or re.search(r'[\\/:<>"|?*\x00-\x1f]', value):
        raise ValueError('Invalid release id')
    return value


def folder(rid):
    return DATA / 'covers' / release_id(rid)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def status(rid):
    path = folder(rid)
    try:
        result = json.loads((path / 'job.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        result = {'state': 'idle'}
    result['candidates'] = [i for i in range(1, 4) if (path / f'cand_{i}.jpg').is_file()]
    return result


def image_path(rid, index):
    if int(index) not in (1, 2, 3):
        raise ValueError('Invalid candidate')
    return folder(rid) / f'cand_{int(index)}.jpg'


def start(rid):
    release_id(rid)
    if not (DATA / 'releases' / f'{rid}.json').is_file():
        raise ValueError('Save the release first')
    if not PYTHON.is_file():
        raise RuntimeError('Maestro env-rtx50 Python is missing')
    lock = DATA / 'covers' / '.worker-lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError('Cover worker is already running; see covers/.worker-lock')
    out = folder(rid)
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / 'job.json', {'state': 'starting', 'updated': datetime.now().isoformat()})
    try:
        with (out / 'worker.log').open('ab') as log:
            subprocess.Popen([str(PYTHON), str(HERE / 'dk_covers.py'), '--release', rid, '--locked'],
                             stdout=log, stderr=subprocess.STDOUT, cwd=HERE, creationflags=FLAGS)
    except Exception:
        write_json(out / 'job.json', {'state': 'error', 'message': 'Unable to launch cover worker; retry',
                                     'updated': datetime.now().isoformat()})
        lock.rmdir()
        raise
    return status(rid)


def artwork_prompt(d):
    from dk_ui import cover_prompt
    # Literal song titles/lyrics make Flux draw lettering even with a negative
    # instruction. Retain the existing visual style/subject, not printable copy.
    text = cover_prompt(d).split('\n\n', 1)[1]
    text = re.split(r'\nLyrics(?: \(Georgian\))?:', text)[0]
    text = re.sub(r'Title:.*?(?=Leave the TOP-LEFT)', '', text, flags=re.S)
    text = re.sub(r'Leave the TOP-LEFT.*?afterwards\.',
                  'Keep the upper corners quiet, dark and uncluttered.', text, flags=re.S)
    text = text.replace("Keep the same style as the artist's previous covers:", 'Visual style:')
    text = text.replace('Take the mood, place and symbols from the lyrics below.', '')
    text = text.replace('taken from the lyrics below', 'expressing memory and longing')
    # Small deterministic vocabulary supplies lyrical imagery locally, without
    # an online translator or feeding the actual words to the image model.
    lyrics = (d.get('lyrics', '') + ' ' + d.get('title', '')).lower()
    motifs = [('მაის', 'spring blossoms in May'), ('ალბომ', 'a faded photograph resting on a table'),
              ('მზ', 'warm sunrise'), ('მთვარ', 'soft moonlight'), ('წვიმ', 'rain on a quiet road'),
              ('ზღვ', 'the distant sea'), ('ვარდ', 'roses'), ('თოვლ', 'snow'),
              ('გულ', 'a feeling of tender love'), ('ხსოვ', 'nostalgic memories')]
    found = [description for word, description in motifs if word in lyrics]
    if found:
        text += '\nVisual inspiration: ' + ', '.join(found[:3]) + '.'
    return ('A square cinematic illustration, 1024x1024 pixels. Pure pictorial artwork: no text, no letters, '
            'no writing, no typography, no logos, no watermark.\n' + text.strip()
            + '\nThe entire picture contains only scenery and subjects, with no lettering or graphic badges.')


def gpu_sample():
    def query(args):
        p = subprocess.run(['nvidia-smi'] + args + ['--format=csv,noheader,nounits'],
                           capture_output=True, text=True, check=True, creationflags=FLAGS)
        return p.stdout.strip()
    rows = query(['--query-gpu=utilization.gpu']).splitlines()
    if len(rows) != 1:
        raise RuntimeError('Cover worker requires one local GPU')
    memory = {}
    for row in query(['--query-compute-apps=pid,used_gpu_memory']).splitlines():
        pid, size = row.split(',')
        memory[int(pid)] = int(size.strip()) if size.strip().isdigit() else None
    return int(rows[0]), memory


def wait_idle(report, timeout=12 * 3600):
    started, idle = time.monotonic(), None
    while time.monotonic() - started < timeout:
        utilization, memory = gpu_sample()
        now = time.monotonic()
        if utilization < 10:
            idle = now if idle is None else idle
            if now - idle >= 60:
                return memory
        else:
            idle = None
        report('waiting', f'GPU {utilization}%; waiting for 60 seconds below 10%')
        time.sleep(5)
    raise RuntimeError('GPU did not become idle in 12 hours; retry later')


def foreign_gpu_work(before, current, own_pid):
    own_pids = {own_pid} if isinstance(own_pid, int) else set(own_pid)
    return any(pid not in own_pids and (pid not in before or size is None or before[pid] is None
               or size > before[pid] + 256) for pid, size in current.items())


def windows_gpu_utilization():
    """WDDM reports VRAM as N/A; Windows counters can attribute active engines."""
    script = r"""$out=@{}; (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples | ForEach-Object {
      if ($_.InstanceName -match '^pid_(\d+)_') {
        $key=$Matches[1]; $value=[math]::Max(0,$_.CookedValue)
        if (!$out.ContainsKey($key) -or $out[$key] -lt $value) {$out[$key]=$value}
      }
    }; ConvertTo-Json -InputObject $out -Compress"""
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                            capture_output=True, text=True, check=True, timeout=20, creationflags=FLAGS)
    return {int(k): float(v) for k, v in json.loads(result.stdout).items()}


def compose(raw, output, d):
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
    with Image.open(raw) as image:
        if image.width != image.height or min(image.size) < 1024:
            raise ValueError('Generated artwork must be square and at least 1024px')
        base = ImageOps.fit(image.convert('RGB'), (3000, 3000), method=Image.Resampling.LANCZOS).convert('RGBA')
    logo = Image.open(HERE / 'za_logo_round.png').convert('RGBA')
    logo.thumbnail((480, 480), Image.Resampling.LANCZOS)
    shadow = Image.new('RGBA', base.size)
    silhouette = Image.new('RGBA', logo.size, (0, 0, 0, 160))
    shadow.paste(silhouette, (100, 104), logo.getchannel('A'))
    base = Image.alpha_composite(base, shadow.filter(ImageFilter.GaussianBlur(10)))
    base.alpha_composite(logo, (90, 90))
    georgian = bool(re.search(r'[\u10a0-\u10ff\u1c90-\u1cbf]', d.get('title', '')))
    title = d.get('title', '').strip() if georgian else d.get('title_en', '').strip()
    if not title and re.search(r'[a-zA-Z]', d.get('title', '')) and d.get('title', '').isascii():
        title = d['title'].strip()
    if not title:
        raise ValueError('A Georgian title or an English title for non-Georgian songs is required')
    font_path = HERE / 'fonts' / ('NotoSerifGeorgian.ttf' if georgian else 'CormorantGaramond.ttf')
    draw = ImageDraw.Draw(base)
    max_width = 2140 if georgian else 2740
    for size in range(205 if georgian else 180, 39, -3):
        font = ImageFont.truetype(str(font_path), size)
        if hasattr(font, 'set_variation_by_name'):
            font.set_variation_by_name('Bold' if georgian else 'Light')
        lines, line = [], ''
        for word in title.split():
            trial = f'{line} {word}'.strip()
            if draw.textbbox((0, 0), trial, font=font)[2] > max_width and line:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
        if len(lines) <= 3 and all(draw.textbbox((0, 0), x, font=font)[2] <= max_width for x in lines):
            break
    else:
        raise ValueError('Title is too long for this cover layout')
    text = '\n'.join(lines)
    anchor, xy = ('ra', (2870, 130)) if georgian else ('md', (1500, 2820))
    shade = Image.new('RGBA', base.size)
    ImageDraw.Draw(shade).multiline_text((xy[0]+5, xy[1]+9), text, font=font, anchor=anchor,
                                      align='right' if georgian else 'center', fill=(0, 0, 0, 240), stroke_width=9)
    base = Image.alpha_composite(base, shade.filter(ImageFilter.GaussianBlur(10)))
    ImageDraw.Draw(base).multiline_text(xy, text, font=font, anchor=anchor,
                                     align='right' if georgian else 'center', fill='white' if georgian else '#dfc997',
                                     stroke_width=3 if georgian else 1, stroke_fill='#302821')
    temp = output.with_suffix('.tmp.jpg')
    base.convert('RGB').save(temp, quality=95, subsampling=0)
    temp.replace(output)


def generate(rid):
    import psutil  # already installed in Maestro; handles Windows venv launcher children
    d = json.loads((DATA / 'releases' / f'{release_id(rid)}.json').read_text(encoding='utf-8'))
    out = folder(rid)
    out.mkdir(parents=True, exist_ok=True)
    def report(state, message=''):
        write_json(out / 'job.json', {'state': state, 'message': message, 'updated': datetime.now().isoformat()})
    try:
        if all(image_path(rid, i).is_file() for i in range(1, 4)):
            report('done', 'Three candidates already exist; choose one below')
            return
        # Pin runtime to existing local models; never download or install dependencies.
        needed = ['flux-2-klein-9b_quanto_bf16_int8.safetensors', 'flux2_vae.safetensors',
                  'qwen3_8b/qwen3_8b_quanto_bf16_int8.safetensors']
        for name in needed:
            if not (MAESTRO / 'ckpts' / name).is_file():
                raise RuntimeError(f'Installed Flux model file is missing: {name}')
        config = json.loads((MAESTRO / 'wgp_config.json').read_text(encoding='utf-8'))
        config['checkpoints_paths'] = [str((MAESTRO / p).resolve()) for p in config['checkpoints_paths']]
        config_dir = out / 'runtime'
        write_json(config_dir / 'wgp_config.json', config)
        for i in range(1, 4):
            if image_path(rid, i).is_file():
                continue
            raw_dir = out / f'raw_{i}'
            raw_dir.mkdir(exist_ok=True)
            seed = secrets.randbelow(2**31)
            settings = {'model_type': 'flux2_klein_9b', 'prompt': artwork_prompt(d),
                        'resolution': '1024x1024', 'num_inference_steps': 4, 'guidance_scale': 1,
                        'image_mode': 1, 'video_length': 1, 'batch_size': 1, 'seed': seed,
                        'prompt_enhancer': '', 'repeat_generation': 1}
            job = out / f'settings_{i}.json'
            write_json(job, settings)
            baseline = wait_idle(report)
            report('generating', f'Candidate {i}/3; Maestro / WanGP Flux Klein 9B')
            env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', PYTHONIOENCODING='utf-8')
            started = time.monotonic()
            with (out / f'maestro_{i}.log').open('wb') as log:
                proc = subprocess.Popen([str(PYTHON), '-u', 'wgp.py', '--process', str(job), '--output-dir', str(raw_dir),
                                         '--config', str(config_dir), '--settings', str(MAESTRO / 'settings')],
                                        cwd=MAESTRO, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=FLAGS)
                try:
                    while proc.poll() is None:
                        time.sleep(5)
                        utilization, memory = gpu_sample()
                        try:
                            own_pids = {proc.pid} | {p.pid for p in psutil.Process(proc.pid).children(recursive=True)}
                        except psutil.NoSuchProcess:
                            if proc.poll() is not None:
                                break
                            raise
                        interference = utilization > 50 and foreign_gpu_work(baseline, memory, own_pids)
                        per_process = None
                        if interference and sys.platform == 'win32':
                            # A newly initialized/idle CUDA server need not be doing work.
                            # On counter failure keep the conservative nvidia-smi decision.
                            try:
                                per_process = windows_gpu_utilization()
                                foreign = set(memory) - own_pids
                                if all(pid in per_process for pid in foreign):
                                    interference = any(per_process[pid] > 50 for pid in foreign)
                            except (OSError, ValueError, subprocess.SubprocessError):
                                pass
                        with (out / 'gpu_samples.jsonl').open('a', encoding='utf-8') as telemetry:
                            telemetry.write(json.dumps({'time': datetime.now().isoformat(), 'candidate': i,
                                            'utilization': utilization, 'memory': memory, 'own_pids': sorted(own_pids),
                                            'per_process': per_process, 'interference': interference}) + '\n')
                        if interference:
                            raise RuntimeError('Another GPU job started; stopped only the cover worker generation')
                        if time.monotonic() - started > 3600:
                            raise RuntimeError('Maestro generation exceeded one hour')
                    if proc.returncode:
                        raise RuntimeError(f'Maestro exited {proc.returncode}; see maestro_{i}.log')
                finally:
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=20)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait()
            images = sorted((f for f in raw_dir.rglob('*') if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')),
                            key=lambda p: p.stat().st_mtime, reverse=True)
            if not images:
                raise RuntimeError('Maestro returned no artwork; see generation log')
            compose(images[0], image_path(rid, i), d)
            write_json(out / f'candidate_{i}.json', {'seed': seed, 'source': str(images[0]),
                       'seconds': round(time.monotonic()-started, 3), 'title': d['title'], 'settings': str(job)})
        report('done', 'Three candidates ready; choose one below')
    except Exception as error:
        report('error', str(error))
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release')
    parser.add_argument('--night', action='store_true')
    parser.add_argument('--locked', action='store_true')
    args = parser.parse_args()
    if not args.release and not args.night:
        parser.error('Use --release ID or --night')
    lock = DATA / 'covers/.worker-lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    if not args.locked:
        try:
            lock.mkdir()
        except FileExistsError:
            raise SystemExit('A cover worker is already running; see covers/.worker-lock')
    failed = False
    try:
        write_json(lock / 'owner.json', {'pid': os.getpid(), 'started': datetime.now().isoformat()})
        ids = [args.release] if args.release else [p.stem for p in sorted((DATA / 'releases').glob('*.json'))
                      if not json.loads(p.read_text(encoding='utf-8')).get('cover')]
        for rid in ids:
            try:
                generate(rid)
            except Exception as error:
                failed = True
                print(f'{rid}: {error}', flush=True)
    finally:
        (lock / 'owner.json').unlink(missing_ok=True)
        lock.rmdir()
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
