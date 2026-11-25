"""Build the local 6/7/8 review sheet; never selects a release cover."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--font', type=Path, required=True)
    args = parser.parse_args()
    output = args.folder / '_choose_cover_new.jpg'
    if output.exists():
        raise SystemExit('Review sheet already exists; leaving it untouched')
    canvas = Image.new('RGB', (1800, 820), '#f4f1e9')
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(args.font), 44)
    number = ImageFont.truetype(str(args.font), 72)
    draw.text((30, 22), 'მაისი-თვრამეტი — ახალი ყდის ვარიანტები', font=font, fill='#222222')
    evidence = []
    for j, i in enumerate((6, 7, 8)):
        path = args.folder / f'cand_{i}.jpg'
        with Image.open(path) as image:
            image.load()
            if image.size != (3000, 3000) or image.mode != 'RGB' or image.format != 'JPEG':
                raise ValueError(f'Invalid candidate {i}')
            thumb = image.resize((560, 560), Image.Resampling.LANCZOS)
        x, y = 30 + 590*j, 120
        canvas.paste(thumb, (x, y))
        draw.ellipse((x+10, y+10, x+110, y+110), fill='#c80b28')
        draw.text((x+60, y+57), str(i), font=number, anchor='mm', fill='white')
        label = {6: 'ფოტო და მაისის დილა', 7: 'ძველი თბილისის აივანი', 8: 'რვეული და მოგონება'}[i]
        draw.text((x, 706), f'#{i} — {label}', font=ImageFont.truetype(str(args.font), 30), fill='#222222')
        evidence.append({'candidate': i, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                         'bytes': path.stat().st_size, 'size': [3000, 3000], 'mode': 'RGB',
                         'generation': json.loads((args.folder / f'candidate_{i}.json').read_text(encoding='utf-8'))})
    canvas.save(output, quality=94, subsampling=0)
    (args.folder / 'validation_new.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Validated 3 RGB JPEGs; wrote ' + str(output))


if __name__ == '__main__':
    main()
