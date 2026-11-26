# First Snow cover candidates — 2026-11-27

Three local review candidates are ready in
`D:/Prog/MusicToVideo/Library/_agent/distrokid/covers/პირველი-თოვლი/`:
`cand_1.jpg`, `cand_2.jpg`, `cand_3.jpg`, plus `_choose_cover.jpg` with large
numbers 1–3. No candidate has been selected or uploaded.

Used the installed UTF-8-fixed `dk_covers.py --release პირველი-თოვლი` and
Maestro's existing Flux Klein 9B CLI, without changing either application.
The release's existing scene prompt supplies the blue winter night, old stone
house, golden window and anonymous adult silhouettes. The CPU compositor adds
the Georgian title at the upper right and existing round ZA logo at the upper
left. The logo retains its existing small brand lettering; no additional text
was added to the artwork.

Compared the set visually with winter `thumbs/_compare_ABC.jpg`. All retain
the snowy blue/gold palette and window motif, with readable titles and no
recognisable faces. Candidate 3 is closest to the requested two figures seen
from behind; candidate 1 has partial silhouette profiles and candidate 2 crops
one figure behind the window edge. These are review alternatives for the owner.

| Candidate | Seed | Generation + composition seconds, excluding idle gate |
| --- | ---: | ---: |
| 1 | 1676806578 | 46.922 |
| 2 | 1256417545 | 37.094 |
| 3 | 270340187 | 36.625 |

Each render passed the worker's full 60-second GPU-below-10% gate. Generation
telemetry is in `gpu_samples.jsonl`; model logs/settings and seeds are retained.
The initial sandboxed renderer used CPU for over three minutes without log
output or GPU work. Stopped only that renderer, retained the attempt status and
telemetry as `sandbox_startup_attempt.json` and
`sandbox_startup_gpu_samples.jsonl`, then retried the same worker with approved
unrestricted execution. That run completed successfully. No other application
was stopped. Final GPU: 0%, 0 MiB; worker lock cleared.

The local `build_review.py` fully decoded all three JPEGs and checked RGB,
3000×3000 dimensions, hashes and unchanged release JSON. Evidence is in
`validation.json`; release SHA-256 before and after:
`b225bdacc2e63f1a68b32fa7d286d444e7c14c01ebbb4f7a5dc32180053b3cc8`.
Its cover field remains empty. No database, production catalog, public covers,
OneDrive checkout, Maestro code/config, models or packages changed. No upload
or publication occurred.

Only repository documentation changed, so the code-change pnpm gates were not
applicable. Next: the owner reviews the numbered sheet and chooses a candidate;
Claude handles the release following explicit owner approval.
