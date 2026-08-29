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
  instrument-parts\
    piano.musicxml     # optional; XML or MXL is also accepted
    piano.mid          # .midi is also accepted
    guitar.musicxml
    guitar.mid
  SHA256SUMS.txt       # optional integrity manifest; never uploaded
  UPLOAD_NOTES.txt     # optional owner notes; never uploaded
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
  "difficulty": null,
  "learning_enabled": true,
  "learning_instruments": ["piano", "guitar"],
  "canonical_source": "musicxml",
  "part_mapping": {},
  "fingering_overrides": {}
}
```

`status` is `draft` or `published`; omitted status defaults to `draft`. `difficulty` is `beginner`, `intermediate`, `advanced`, or `null`. Slugs use lowercase ASCII letters/numbers separated by single hyphens.

Do not guess credits, lyrics, dates, or ownership. `display_credit` records the verified public display label; it is not a substitute for unknown composer/lyricist fields.

Learning mode is opt-in. `learning_instruments` accepts `piano` and `guitar`;
`canonical_source` is `musicxml` or `midi`. `part_mapping` and
`fingering_overrides` must be JSON objects. The importer maps these fields to
the archive's `learning_*` columns and stores each nested part in
`instrument_parts`. Instrument-part files are versioned in `song_files` and
stored under `<slug>/instrument-parts/<instrument>/...` in the
`instrument-parts` bucket.

When `SHA256SUMS.txt` exists, every other package file—including metadata and
`UPLOAD_NOTES.txt`—must be listed and match. Paths may be relative or may have
an external build prefix, provided they end in the exact package-relative path.
The importer rejects a mismatch before any database or Storage write.

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
| Piano/guitar part | MusicXML, XML, MXL, MID, MIDI | 20 MB each |

The importer validates filename, size, and file signatures (magic bytes), then calculates SHA-256 checksums. Lyrics containing literal `\n`, `\r`, or `\r\n` sequences are normalized to real line breaks.
