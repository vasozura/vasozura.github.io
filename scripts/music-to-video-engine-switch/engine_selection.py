"""Job-scoped engine selection for MusicToVideo. Uses the installed WanGP CLIs."""
from __future__ import annotations

import json
import math
import re
import functools
import subprocess
import threading
import time
from pathlib import Path

WAN_MODEL = 'i2v_2_2_Enhanced_Lightning_v2_svi2pro'
LTX_MODEL = 'ltx2_22B_distilled_1_1'
ENGINES = {'wan22': WAN_MODEL, 'ltx23': LTX_MODEL}
_LAUNCH_LOCK = threading.Lock()


def serialized_launch(fn):
    @functools.wraps(fn)
    def launch(*args, **kwargs):
        with _LAUNCH_LOCK:
            return fn(*args, **kwargs)
    return launch


def gpu_sample():
    flags = dict(creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=8, text=True)
    raw = subprocess.check_output(['nvidia-smi', '--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], **flags)
    rows = [[int(v) for v in row.split(',')] for row in raw.strip().splitlines()]
    raw_pids = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader,nounits'], **flags)
    return max(row[0] for row in rows), sum(row[1] for row in rows), {int(p) for p in raw_pids.splitlines() if p.strip().isdigit()}


def wait_idle():
    started = time.monotonic()
    while True:
        utilization, _, pids = gpu_sample()
        if utilization >= 10:
            raise RuntimeError(f'GPU is busy ({utilization}%); generation was not started.')
        if time.monotonic() - started >= 60:
            if pids:
                raise RuntimeError('Another GPU runtime is open; do not start a second WanGP/Maestro copy.')
            return
        time.sleep(5)


def watch_gpu(process, interrupt):
    """Stop our process tree if another process begins a GPU generation."""
    import psutil
    while process.poll() is None:
        time.sleep(2)
        try:
            utilization, _, pids = gpu_sample()
            own = {process.pid} | {child.pid for child in psutil.Process(process.pid).children(recursive=True)}
            if utilization > 50 and pids - own:
                interrupt('Stopped: another process began using the GPU.')
                return
        except psutil.NoSuchProcess:
            return
        except Exception as error:
            if process.poll() is None:
                interrupt(f'Stopped: GPU monitoring failed: {error}')
            return


def mark_queue(path, engine):
    Path(str(path) + '.engine.json').write_text(json.dumps({'engine': validate(engine)}), encoding='utf-8')


def guarded_queue(path):
    return Path(str(path) + '.engine.json').is_file()


def validate(engine):
    if engine not in ENGINES:
        raise ValueError('Choose Wan 2.2 or LTX-2.3; MiniMax H3 is coming later.')
    return engine


def split_shots(items, beats=()):
    """Split before keyframe generation, choosing a beat at/before the 10s limit."""
    result = []
    for item in items:
        start, end = float(item['start']), float(item['end'])
        if not math.isfinite(start + end) or end <= start:
            raise ValueError('Every shot must have a finite positive duration.')
        while start < end - 1e-6:
            stop = min(end, start + 10)
            if stop < end:
                choices = [float(b) for b in beats if start + 0.5 < float(b) <= stop]
                if not choices:
                    raise ValueError('A long shot needs beat positions before it can be split safely.')
                stop = max(choices)
            row = dict(item, start=start, end=stop, clip_index=len(result))
            if stop < end:
                row.pop('end_image_file', None)
            result.append(row)
            start = stop
    return result


def prepare(items, engine):
    validate(engine)
    result = []
    for item in items:
        duration = float(item['end']) - float(item['start'])
        if not 0 < duration <= 10:
            raise ValueError('Split shots on beats to at most 10 seconds before generation.')
        if not Path(item.get('start_image_file') or '').is_file():
            raise ValueError('Every shot needs its own approved start keyframe.')
        row = dict(item, i2v_model=ENGINES[engine])
        # A quiet camera is the default; preserve the author-selected shot action.
        parts = re.split(r'\bNegative\s*:', str(row.get('wan_prompt') or ''), maxsplit=1, flags=re.I)
        prompt = parts[0].strip()
        if not prompt:
            raise ValueError('Each shot needs one clear action in its prompt.')
        if not any(word in prompt.lower() for word in ('camera', 'pan ', 'zoom', 'tracking', 'dolly')):
            prompt += ' The camera holds steady.'
        if engine == 'wan22' and len(parts) > 1:
            prompt += ' Negative: ' + parts[1].strip()
        row['wan_prompt'] = prompt
        result.append(row)
    return result


def ltx_settings(item, job, seed=-1):
    duration = float(item['end']) - float(item['start'])
    # LTX uses 8n+1 frames. Choose at/below 10s, including its first frame.
    frames = max(9, min(241, math.ceil(duration * 24 / 8) * 8 + 1))
    params = dict(model_type=LTX_MODEL, prompt=item['wan_prompt'], negative_prompt='',
                  resolution='1280x704', num_inference_steps=8, force_fps="24",
                  video_length=frames, duration_seconds=duration, seed=seed,
                  guidance_scale=1, image_prompt_type='S',
                  image_start=str(Path(item['start_image_file']).resolve()),
                  output_filename=f"{job}_c{item['clip_index']:03d}")
    if item.get('end_image_file'):
        params.update(image_prompt_type='SE', image_end=str(Path(item['end_image_file']).resolve()))
    guide = item.get('mix_file') or (item.get('vocal_files') or [None])[0]
    if guide:
        params.update(audio_prompt_type='A', audio_guide=str(Path(guide).resolve()))
    return params


def write_ltx(items, job, out_path, seed=-1):
    out = Path(out_path).with_suffix('.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    tasks = []
    for item in prepare(items, 'ltx23'):
        item = dict(item)
        keyframes = out.parent / (out.stem + '_keyframes')
        keyframes.mkdir(exist_ok=True)
        for field in ('start_image_file', 'end_image_file'):
            if not item.get(field):
                continue
            target = keyframes / f'{item["clip_index"]:03d}_{field}.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(item[field]),
                            '-vf', 'scale=1280:704:force_original_aspect_ratio=decrease,pad=1280:704:(ow-iw)/2:(oh-ih)/2',
                            '-frames:v', '1', str(target)], check=True,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            item[field] = str(target)
        settings = ltx_settings(item, job, seed)
        shot = out.with_name(f'{out.stem}_shot_{item["clip_index"]:03d}.json')
        shot.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding='utf-8')
        tasks.append(settings)
    if not tasks:
        raise ValueError('No shots to generate.')
    out.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding='utf-8')
    mark_queue(out, 'ltx23')
    return out
