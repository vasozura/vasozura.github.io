# Windows song importer

The importer validates a package before any network write. Always begin with a dry run.

## Dry run (no credentials required)

From the repository root:

```powershell
pnpm import:song -- ".\song-packages\song-slug" --dry-run
```

or:

```powershell
.\scripts\import-song.ps1 -PackagePath ".\song-packages\song-slug" -DryRun
```

The JSON report lists validation issues and the SHA-256 checksum of every
skipped upload. Optional `SHA256SUMS.txt`, `UPLOAD_NOTES.txt` and
`suno-provenance.json` files are validated/recognized but are never uploaded.

## Real import

Use a trusted local PowerShell session. The service-role key is required because this offline owner tool performs authenticated administrative writes; it is never used by browser code.

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"
.\scripts\import-song.ps1 -PackagePath ".\song-packages\song-slug"
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Do not paste credentials into command history, source files, screenshots, issues, or chat. Prefer setting the environment variable in a short-lived private terminal session.

## Import semantics

1. Validate metadata, expected filenames, size, extension, and magic-byte MIME signature.
2. Normalize literal newline sequences in lyrics.
3. Calculate SHA-256 for every resource.
4. Refuse an existing slug unless it is an explicitly reviewed draft resume.
5. Query `song_files` for the same song/checksum.
6. Reuse duplicates; otherwise upload to the resource bucket under `<slug>/<checksum-prefix>-<filename>`.
7. Stage every immutable object, then finalize the song, files and parts in one database transaction.
8. Print a structured success/error report.

Nested piano, guitar and accordion resources use
the private `instrument-parts` bucket and upsert one `instrument_parts` row per
instrument. Learning package keys are mapped to the existing `learning_*`
columns; MusicXML or MIDI may be selected as the canonical source.

## Learning API staging

The canonical archive resource remains in its normal private resource bucket.
When the external Learning API processes MusicXML, copy the checksum-verified
canonical object to the private `scores/<slug>/` staging path. The `scores`
bucket has an explicit MIME allowlist for PDF and supported MusicXML media
types; it remains private and does not accept wildcard MIME types.

If staging fails before database finalization, compensation removes only the
objects uploaded by that run. If Learning processing fails after finalization,
the private draft remains intact and the report stops with `processing=failed`;
no pre-existing object is deleted.

The process is safe to run again. Matching checksums avoid duplicate uploads; changed files create a new version.

## Batch readiness and resume

Use the versioned `zura-song-batch/v1` manifest shown in `docs/sample-batch.json`:

```powershell
pnpm import:batch -- ".\docs\sample-batch.json" --dry-run
```

Or use the Windows wrapper:

```powershell
.\scripts\import-batch.ps1 -ManifestPath ".\docs\sample-batch.json" -DryRun
.\scripts\import-batch.ps1 -ManifestPath ".\approved-batch.json" -Resume -Concurrency 2
```

The batch validates every package before the first write, runs at most four
workers, continues independent songs after one failure, and writes only a
non-secret `.checkpoint.json`. A real batch must pass dry-run before the
server-only credential and short-lived owner token are supplied.

## Phase 6 Suno preparation

The reviewed Phase 6 records live in `docs/phase6-suno-records.json`. Generate
the five local packages from the checksum-verified archive MP3 files and the
owner-provided lyric export:

```powershell
pnpm prepare:phase6 -- --audio-root="C:\path\to\approved\mp3-archive" --lyrics-source="C:\path\to\Suno-lyrics.txt" --output="tmp\phase6-suno-import"
pnpm import:batch -- "tmp\phase6-suno-import\phase6-batch.json" --dry-run
```

The generator refuses to overwrite an existing package and stops on any
canonical MP3 checksum mismatch. Generated packages are draft-only. They keep
Suno generation metadata separate from the unchanged local audio binary,
preserve verified per-song attribution, apply confirmed project defaults and
carry the separately confirmed final-MP3 and Learning decisions.
