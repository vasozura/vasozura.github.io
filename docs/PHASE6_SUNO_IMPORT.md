# Phase 6 Suno import preparation

Phase 6 connects three reviewed sources without treating them as equivalent:

- Suno supplies stable generation metadata, lyrics and style/prompt evidence.
- The approved local archive supplies the canonical MP3 binary and SHA-256.
- YouTube supplies corroborating public video identity and duration.

The preparation dataset contains exactly source indices 51, 52, 53, 55 and
144. The supplied workbook first matched SHA-256
`387bfbf12230618a80c4e3ce662cbfe3561eec9aa0be01fa84057717aeb8f261`.
An independent hash of the Index 55 `_1.mp3` exposed one transcription error
in `Suno Shortlist!M9`; the versioned corrected workbook has SHA-256
`5bca4c50268cec128ab7ba3b6b987e22a83550397a873aabd93d9b5bbcf61b25`.
No other workbook value or structure changed.

## Schema extension

The existing `songs.suno_url` field cannot represent generation identity or
alternates. Migration `202609060001_phase6_suno_provenance.sql` therefore adds
only:

- `public.suno_generations`, with one partial-unique canonical row per song;
- a global unique Suno generation ID, preventing reuse across songs;
- public-read RLS only through a published parent song;
- owner/admin mutation RLS;
- `finalize_song_import_with_suno_provenance`, which validates generation
  metadata and calls the existing transactional song finalizer before inserting
  provenance rows in the same transaction.

The migration contains no update, delete, truncate, drop, Storage statement or
policy replacement. It is prepared for later review and is not applied during
the dry-run task.

## Package readiness

Every generated package contains `metadata.json`, the unchanged `audio.mp3`,
source-language lyrics in the archive's existing non-Georgian fallback slot,
`suno-provenance.json`, `UPLOAD_NOTES.txt` and `SHA256SUMS.txt`. Exact Suno
titles are repeated in both required title slots without claiming a Georgian
translation.

Composer, lyricist/poet, translator, recording rights and publication rights
now follow the confirmed project defaults while preserving the verified Berdia
Beriashvili attribution for indices 51, 52, 53 and 55. Final MP3 approval and
Learning mode are owner-confirmed for all five canonical packages. The packages
remain draft-only; this confirmation does not itself import or publish them.

## Index 55 invariant

Canonical generation `6b85f175-2289-4eac-88fb-5483153bd01b` maps to the
257.600-second local MP3 and the 258-second YouTube video. Generation
`81dc6c14-63c3-4104-a806-3efa99f38601` maps with high confidence to the
278.440-second `_1.mp3` and remains an alternate. Similar titles cannot replace
the canonical generation.
