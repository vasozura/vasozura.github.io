# Local library integrity repair — 2026-11-18

`scripts/repair-local-library-integrity.ts --apply` validated and reconciled 34 stale asset checksums in `D:\ComposerArchive\02_DATABASE\library.db`. Before the transaction it copied the database to `D:\ComposerArchive\04_BACKUP\library-before-integrity-repair-2026-11-18T18-55-16-585Z.db`. No production database, publication state, portfolio data, cover, or media binary was changed.

All 34 current binaries passed format validation (FFprobe for WAV/MP3 and `@tonejs/midi` for MIDI). The transaction updated the local asset checksum, byte count, parsed metadata and validation event, then regenerated the affected song-level `metadata.json` and `hashes.json` snapshots. A second audit returned zero checksum mismatches.

The previous `metadata-review` list was caused by checking one fixed number of parent directories: that resolves to `audio` for `audio/alternates/*` and `suno` for `suno/original/*`, instead of the song root. The repair tool resolves the root from `01_LIBRARY/songs/<song folder>` for every asset. Its post-repair audit found zero missing song-level metadata records.

## Slugs for Claude to compare with `portfolio.json`

- `suno-1b43514d`
- `suno-2017ae41`
- `suno-304f1b29`
- `suno-4cd7f85c`
- `suno-80ccf1f1`
- `suno-b1c35a84`
- `youtube-iufdba-ntdu`
- `youtube-nasbv06dies`
- `youtube-tifbclrcdhc`
- `youtube-tzjihucwzya`

The complete before/after checksum evidence is stored locally in `D:\ComposerArchive\05_LOGS\integrity-repair-2026-11-18T18-55-16-585Z.json`.
