# Song package format

Each import package is one directory whose name should match its slug:

```text
song-slug\
  metadata.json
  audio.mp3
  cover.webp
  lyrics-ka.txt
  lyrics-en.txt
  score.musicxml        # or score.xml / score.mxl
  performance.mid       # .midi is also accepted
  score.pdf
  source.mscz
```

Only `metadata.json` is mandatory. Omit any unavailable resource; do not create empty placeholder files. Provide only one of `score.musicxml`, `score.xml`, or `score.mxl`.

## metadata.json

```json
{
  "slug": "example-song",
  "status": "draft",
  "title_ka": "ქართული სათაური",
  "title_en": "English title",
  "display_credit": "Verified display credit",
  "composer": null,
  "lyricist": null,
  "translator": null,
  "language": "ka",
  "description_ka": null,
  "description_en": null,
  "suno_url": null,
  "youtube_url": null,
  "duration_seconds": null,
  "bpm": null,
  "musical_key": null,
  "time_signature": null,
  "difficulty": null
}
```

`status` is `draft` or `published`; omitted status defaults to `draft`. `difficulty` is `beginner`, `intermediate`, `advanced`, or `null`. Slugs use lowercase ASCII letters/numbers separated by single hyphens.

Do not guess credits, lyrics, dates, or ownership. `display_credit` records the verified public display label; it is not a substitute for unknown composer/lyricist fields.

## Accepted content

| Resource | Extensions | Maximum |
|---|---|---:|
| Cover | JPG, JPEG, PNG, WebP | 5 MB |
| MP3 | MP3 | 100 MB |
| MIDI | MID, MIDI | 5 MB |
| Interactive score | MusicXML, XML, MXL | 20 MB |
| Printable score | PDF | 25 MB |
| MuseScore archive | MSCZ | 50 MB |
| Lyrics | TXT / direct admin entry | 1 MB |

The importer validates filename, size, and file signatures (magic bytes), then calculates SHA-256 checksums. Lyrics containing literal `\n`, `\r`, or `\r\n` sequences are normalized to real line breaks.
