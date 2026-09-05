# Phase 5 architecture

## Data flow

1. A local owner package is validated without credentials: metadata schema,
   Unicode paths, magic bytes, size, archive safety and SHA-256.
2. Storage objects are staged under immutable checksum-addressed paths.
3. `finalize_song_import` verifies every staged object and atomically writes the
   private draft, `song_files` and `instrument_parts` rows.
4. Learning-enabled imports validate and process the canonical source through
   the typed Learning API client with `publish=false`.
5. Publication remains a separate owner action guarded by the atomic
   Learning/archive readiness function in API migration
   `0006_phase5_publication_readiness.sql`.

Storage and PostgreSQL cannot share a transaction. Before database finalization
the importer compensates only objects created by its current run. After a
successful finalization, any processing failure leaves the complete private
draft intact for explicit recovery.

## Catalog queries

The public catalog queries `status=published`, uses deterministic
`published_at DESC, id ASC` ordering, 24-row pages, debounced search, bounded
filters and request cancellation. Direct song routes fetch one published slug,
so deep links remain stable outside the current page. Covers are lazy-loaded.

## Security assumptions

- Browser code uses only the publishable Supabase key and a user session.
- The offline importer accepts a server credential only in process memory.
- The Learning API receives a short-lived owner access token only for protected
  processing calls.
- Import tables are owner-only under RLS. Anonymous reads remain limited to
  published archive and Learning data.
- Private signed URLs are kept in memory and are never placed in route URLs,
  reports, checkpoints or persistent browser storage.

## Performance budgets

- Initial catalog page: at most 24 rows.
- Batch concurrency: 1–4, default 2.
- Package: at most 2,048 files and 512 MB expanded.
- Archive compression ratio: at most 100:1 for files over 1 MB.
- OSMD, MIDI and Learning remain route/interaction lazy-loaded.
- Main JavaScript is capped at 450 KB; Learning at 100 KB; each instrument
  visualizer at 25–35 KB; OSMD at 1.6 MB (raw minified sizes). The build fails
  when a budget is exceeded.
