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
skipped upload. Optional `SHA256SUMS.txt` and `UPLOAD_NOTES.txt` files are
validated/recognized but are never uploaded.

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
4. Upsert the song by slug.
5. Query `song_files` for the same song/checksum.
6. Reuse duplicates; otherwise upload to the resource bucket under `<slug>/<checksum-prefix>-<filename>`.
7. Insert the versioned `song_files` record and update the corresponding URL on `songs`.
8. Print a structured success/error report.

Nested `instrument-parts/piano.*` and `instrument-parts/guitar.*` resources use
the private `instrument-parts` bucket and upsert one `instrument_parts` row per
instrument. Learning package keys are mapped to the existing `learning_*`
columns; MusicXML or MIDI may be selected as the canonical source.

## Learning API staging

The canonical archive resource remains in its normal private resource bucket.
When the external Learning API processes MusicXML, copy the checksum-verified
canonical object to the private `scores/<slug>/` staging path. The `scores`
bucket has an explicit MIME allowlist for PDF and supported MusicXML media
types; it remains private and does not accept wildcard MIME types.

If a production failure occurs after the draft row or any Storage object has
been created, the report sets `partial: true` and lists every completed upload.
The importer intentionally does not roll back or delete that partial draft;
inspect the reported state before retrying.

The process is safe to run again. Matching checksums avoid duplicate uploads; changed files create a new version.
