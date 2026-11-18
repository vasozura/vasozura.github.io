# Shared task board (Codex ↔ Claude)

Claude assigns and orders the tasks, and Codex works through them from the top. Codex reports by ticking the task and adding a short result line under it (what changed, commit, anything blocked). Each task uses one line: `- [ ] owner · task · details`. Mark it `[~]` while it is in progress and `[x]` when it is done, adding the date and commit.

## Open

- [x] Codex · 2026-11-18 · Fix the 34 SHA-256 mismatches and the metadata-review records in the local library · Commit `2270856`.
  Reconciled all 34 parse-valid local assets after creating a DB backup; repeat audit is 0 checksum mismatches and 0 missing song-level metadata records. The 10 affected slugs for Claude are in `docs/LOCAL_LIBRARY_INTEGRITY_2026-11-18.md`; no production or portfolio data changed.
- [ ] Codex · Add a "coming soon" note to the services block (`src/components/services.ts`), KA and EN · Text: KA "მალე: კარაოკე-ვერსიები და ნოტები — ფორტეპიანო, გიტარა, აკორდეონი"; EN "Coming soon: karaoke versions and sheet music — piano, guitar, accordion". Show it as a small muted line or badge under the three service cards. No price, no order button, no link. Approved by the owner on 2026-11-18. Run typecheck, test and build, then push.
- [ ] Codex · Resume the Suno WAV collection on 2026-11-26 (queue at Source 216) · The site already has 172 unique published songs. Before creating any new song row, check `public/data/portfolio.json` (`order` and `hidden`) and the live catalog, so the import does not duplicate a song.
- [ ] Codex · Finish one song end to end in the karaoke and learning pipeline (prepare:vocal → verify → publish:karaoke) · Pick the hit "სიგიჟემდის მიყვარდი, მაშინ" if it is available. This is the MVP for a possible karaoke and sheet-music product, which Claude's research is evaluating in `D:\Prog\MusicToVideo\Library\_agent\karaoke_notes_business.md`.
- [ ] Codex · Make CI green · `pnpm audit --prod` fails on the transitive `picomatch <=4.0.7` (opensheetmusicdisplay > gl > node-gyp). A pnpm override `picomatch: ">=4.0.8"` is probably enough.
- [ ] Codex · In `src/data/portfolio.ts`, make `releaseCoverFor` prefer `artwork` (`/covers/<slug>.webp`) over the Spotify cover id, so the owner can replace any cover · This is a small change. Add a test.
- [ ] Claude · Each week, add new songs to portfolio.json and generate covers for them, then prepare import packages in `D:\Prog\MusicToVideo\Library\_agent\site_import` · The owner runs `ATVIRTVA.bat`.
- [ ] either · Review the language labels and lyrics of the 57 songs imported on 2026-11-18 · Their slugs are listed in `D:\Prog\MusicToVideo\Library\_agent\site_import\import_records.json` and `import_records_2026-11-18b.json`.

## Done

- [x] Claude · 2026-11-18 · Moved the site to the domain zuraalexandria.com with HTTPS and switched Pages to the GitHub Actions source. Built the portfolio sections (videos, services), set the catalog to newest-written order without duplicates, imported and published 57 songs, cleaned 30 titles, added Spotify and Apple Music links and 88 covers · Commits 9f6d6fb…66af1e6.
