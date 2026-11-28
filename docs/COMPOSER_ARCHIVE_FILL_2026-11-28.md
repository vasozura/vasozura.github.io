# Composer Archive fill checkpoint — 2026-11-28

ბიბლიოთეკის შევსება შეჩერებულია უსაფრთხოების შემოწმებაზე. ამჟამად არის 480 სიმღერა; 85-ს აქვს WAV, 405-ს MP3, 16-ს MIDI/ZIP და 230-ს ტექსტი. შემოწმებამ გამოავლინა 7 MP3 ფაილის ჰეშის შეუსაბამობა. არსებული იმპორტერი შეიძლება გადააწეროს ორიგინალ აუდიოს; საჭიროა უსაფრთხო, კოლიზიებისგან დაცული იმპორტი. ამ გაშვებას ბიბლიოთეკა არ შეუცვლია და არაფერი გამოუქვეყნებია.

The task manifest predates work recorded in `05_LOGS/claude_fill_2026-11-28.json`: 516 duplicate moves, 20 new songs and 93 attachments. These are earlier logged operations, not operations performed by this run.

| Indexed songs/assets | Before earlier fill backup | Current / unchanged by this run |
|---|---:|---:|
| Songs | 460 | 480 |
| Songs with WAV | 38 | 85 |
| Songs with MP3 | 385 | 405 |
| Songs with MIDI or MIDI ZIP | 15 | 16 |
| Songs with LYRICS_KA | 229 | 230 |

Counts represent distinct song IDs with indexed assets, not a claim that all assets are verified. 262 non-JSON files remain in NEEDS_REVIEW (54 WAV, 161 MP3, 9 MIDI, 24 ZIP and 14 other files). Files were not moved during this run.

## Preservation and checks

Created a consistent SQLite backup using sqlite3.backup at `04_BACKUP/library-before-fill-2026-11-28.db`; existing earlier backups were retained. Logical database dump hashes before and after this run match. SQLite integrity_check is ok; foreign_key_check is empty; no repeated non-null generation_id was found.

Hashed all 1,279 indexed assets. Seven MP3 paths disagree with their indexed SHA-256: asset IDs 143, 151, 154, 158, 467, 552 and 716. All seven expected hashes also occur in the earlier pre-fill database; this does not establish when the files changed. No files were missing.

The tooling's own `verifyManualLibrary` was run against a database snapshot, retaining the live absolute asset paths. It returned ok=false with the same seven SHA errors. Its full output is `05_LOGS/fill_tool_validation_2026-11-28.json`. The snapshot is `05_LOGS/fill_validation_snapshot_2026-11-28/`. The independent audit in `05_LOGS/fill_audit_2026-11-28.json` also records 460 per-file metadata/hash inventory findings: missing files, asset hashes absent from a folder inventory, or folders shared by different song IDs. These are review findings, not 460 confirmed corrupt songs; metadata ownership must be resolved before regeneration.

## Blocker and next action

The required worktree's `src/library/manual-master-library.ts` importer unconditionally copies to audio/original.mp3 or audio/original.wav and removes its source afterward. Its ZIP extractor also creates destination files without collision protection. The UI addAsset/confirmReviewImport paths call that same importer; addAsset rejects lyrics. Running the remaining alternate/ambiguous inputs through it risks replacing existing masters, and the metadata writer can overwrite inventories in shared-title folders.

Do not rerun the full manifest: it is stale after the earlier fill. First provide a collision-safe attachment path in the tooling (unique alternate destinations, preserved sources and sidecars, explicit folder/song ownership, lyrics support), then resolve the seven hash mismatches from preserved copies without rewriting database truth. Reconcile current files against ledger generation IDs before creating more songs. Existing database-row changes require the owner's explicit approval under this scheduled run's rules. UI verification is pending; GET /api/dashboard on 127.0.0.1:4783 timed out. The UI was not launched because its constructor opens/migrates the live database.

No production row changes, source deletions, public portfolio/covers changes, OneDrive checkout changes, uploads or publication were performed. Repository changes are documentation only; pnpm code-change gates are not applicable.
