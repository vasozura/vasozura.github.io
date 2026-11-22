"""Install the reviewed MusicToVideo patch, guarded by source hashes and backups.

Defaults to validation only. Pass --apply to write the seven application files.
Never modifies the WanGP/Maestro installs or their settings.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

HERE = Path(__file__).resolve().parent
ALLOWED = {'main.py', 'ui.html', 'designer.html', 'generator/wan_queue.py',
           'generator/wan_cli.py', 'assembler/video_assembler.py', 'engine_selection.py'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def apply_diff(source, hunks):
    old = source.splitlines(keepends=True)
    result, cursor = [], 0
    for header, body in hunks:
        start = int(re.match(r'@@ -(\d+)', header)[1]) - 1
        if start < cursor:
            raise RuntimeError('Overlapping patch hunks')
        result.extend(old[cursor:start])
        cursor = start
        for line in body:
            if line[0] in ' -':
                if cursor >= len(old) or old[cursor] != line[1:]:
                    raise RuntimeError('Source context no longer matches the reviewed patch')
                cursor += 1
            if line[0] in ' +':
                result.append(line[1:])
    result.extend(old[cursor:])
    return ''.join(result).encode('utf-8')

def parse_patch():
    files, current, hunk = {}, None, None
    for line in (HERE / 'engine-switch.patch').read_text(encoding='utf-8').splitlines(keepends=True):
        if line.startswith('--- a/'):
            continue
        if line.startswith('+++ b/'):
            current = line[6:].strip()
            if current not in ALLOWED:
                raise RuntimeError('Unexpected patch target')
            files[current] = []
            hunk = None
        elif line.startswith('@@ '):
            hunk = (line, [])
            files[current].append(hunk)
        elif line[:1] in (' ', '+', '-') and hunk is not None:
            hunk[1].append(line)
        else:
            raise RuntimeError('Unsupported patch line')
    return files

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', default=r'D:\Prog\MusicToVideo\Program')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    target = Path(args.target).resolve()
    manifest = json.loads((HERE / 'install-manifest.json').read_text(encoding='utf-8'))
    if set(manifest) != ALLOWED:
        raise RuntimeError('Unexpected installation manifest')
    files, prepared = parse_patch(), {}
    for relative, expected in manifest.items():
        destination = (target / relative).resolve()
        if not destination.is_relative_to(target):
            raise RuntimeError('Installation path escaped the program folder')
        before = destination.read_bytes() if destination.exists() else None
        current = digest(before) if before is not None else None
        if current == expected['after']:
            continue
        if current != expected['before']:
            raise RuntimeError(f'{relative} changed since review; installation stopped before writes')
        after = ((HERE / 'engine_selection.py').read_text(encoding='utf-8').encode('utf-8') if relative == 'engine_selection.py'
                 else apply_diff(destination.read_text(encoding='utf-8'), files[relative]))
        if digest(after) != expected['after']:
            raise RuntimeError(f'Patched hash mismatch: {relative}')
        if relative.endswith('.py'):
            compile(after.decode('utf-8'), relative, 'exec')
        prepared[relative] = (destination, before, after)
    print(f'Validated {len(manifest)} files; {len(prepared)} changes pending.')
    if not args.apply:
        return
    backup = target / '_engine_switch_backup_20261122'
    for relative, (destination, before, after) in prepared.items():
        if before is None:
            continue
        saved = backup / relative
        if saved.exists() and saved.read_bytes() != before:
            raise RuntimeError(f'Existing backup differs: {relative}; no application files changed')
        saved.parent.mkdir(parents=True, exist_ok=True)
        if not saved.exists():
            shutil.copy2(destination, saved)
    for relative, (destination, before, after) in prepared.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            stream.write(after)
            temporary = stream.name
        os.replace(temporary, destination)
        print('Installed', relative)

if __name__ == '__main__':
    main()
