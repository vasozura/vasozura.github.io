"""Backup-first installer; refuses to replace independently edited application files."""
from pathlib import Path
import hashlib
import shutil
from datetime import datetime

HERE = Path(__file__).resolve().parent
TARGET = Path(r'D:\Prog\YT_Upload\DistroKid')
ORIGINAL = {
    'dk_ui.py': '5f8524d9ea3328657956462cdf448a782fb0b5422bbf185f25b476276bca68ed',
    'dk_ui.html': 'c4b9a44c6f0668078df0292aaff19f226bb0d99b41225d3bdd387bbd5b18e4cb',
}
# Reviewed concurrent additions: batch suggestion selection and needs_cover flag.
# The source package preserves them; allow only these exact local revisions.
REVIEWED = {
    'dk_covers.py': '606ccda324388fd02b8767aea27f5e62ca23f027289d330a37b9fcda2776c051',
    'dk_ui.py': 'cc69cbb45acd9cd112dd5f3fd15228fc0bbbdbaba05422010d47a69b9fd6eb59',
    'dk_ui.html': 'e358d96e653c38fcf9d240df2a6fba415890999bac4086f1be578b31f1790359',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker-only', action='store_true', help='Update only dk_covers.py, preserving local UI edits')
    args = parser.parse_args()
    files = ['dk_ui.py', 'dk_ui.html', 'dk_covers.py', 'COVERS_NIGHT.bat']
    files += [str(p.relative_to(HERE)) for p in (HERE / 'fonts').iterdir() if p.is_file()]
    if args.worker_only:
        files = ['dk_covers.py']
    manifest = TARGET / '_covers_installed.json'
    import json
    installed = json.loads(manifest.read_text()) if manifest.exists() else {}
    for name in files:
        dest = TARGET / name
        if dest.exists() and digest(dest) not in (ORIGINAL.get(name), REVIEWED.get(name), installed.get(name), digest(HERE / name)):
            raise SystemExit(f'Refusing independently modified file: {dest}')
    backup = TARGET / ('_covers_backup_' + datetime.now().strftime('%Y%m%d_%H%M%S'))
    for name in files:
        dest = TARGET / name
        if dest.exists():
            old = backup / name
            old.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, old)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / name, dest)
    installed.update({name: digest(HERE / name) for name in files})
    manifest.write_text(json.dumps(installed, indent=2))
    print(f'Installed {len(files)} files; originals: {backup}')


if __name__ == '__main__':
    main()
