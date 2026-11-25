# Local DistroKid cover preparation

This is a reviewable installation package for the owner's local Upload Center.
It uses the existing **Maestro / WanGP Flux Klein 9B** image generator, not a
remote image service. It never uploads media, selects a cover automatically,
or changes site data. Maestro is not updated or reinstalled.

Run `python scripts/distrokid-covers/install.py` from the repository to install.
The installer checks the original/previously installed SHA-256 hashes, refuses
independent edits and backs up replaced files beneath the DistroKid directory.
The original round logo already lives there; the copy here supports compositor
tests. Existing YouTube tools and manual cover import remain available.

In the release editor, **🎨 ყდის გენერაცია** saves the current release and starts
a hidden worker. Its progress and three clickable thumbnails appear beneath
the cover controls. **აირჩიე** sets the selected candidate as the local release's
`cover`; generation alone leaves the release metadata and cover selection alone.
The existing helper must be restarted once to load new routes.

`DistroKid/COVERS_NIGHT.bat` processes release JSON files without a cover. Run it
from an existing night scheduler or manually; this package does not register a
Windows scheduled task. It skips completed sets and leaves all choices to the
owner. Partial sets resume without overwriting existing candidates. Per-release
errors are logged and the batch continues, returning a failing exit code if any
release failed. For non-Georgian releases fill in `title_en` before generating.

Runtime defaults:

- Data: `D:/Prog/MusicToVideo/Library/_agent/distrokid` (`DK_DATA` override).
- Maestro: `D:/pinokio/api/Maestro.git/app` (`DK_MAESTRO` override).
- Worker Python: Maestro's installed `env-rtx50/Scripts/python.exe`; Pillow is
  and psutil are already available there. The HTTP server remains
  standard-library Python.
- Installed model: `flux2_klein_9b`, 1024×1024, four steps, CFG 1, three random
  seeds. The transformer's int8 checkpoint, Qwen3 8B int8 encoder and Flux2 VAE
  must already exist. Hugging Face/Transformers offline mode prevents downloads.
- Existing cover prompt visual style, subject and composition are retained.
  Literal titles, lyrics and lettering instructions are removed: otherwise Flux
  may reproduce them despite “no text, no letters”. A small local keyword map
  carries lyrical motifs such as May blossoms, sunrise, rain and memories into
  the artwork brief, without any translation API.
- Final RGB JPGs are 3000×3000 with Lanczos resampling, the round logo at the
  upper left, and program-rendered Georgian bold serif at the upper right or
  the English title in light pale-gold serif at the bottom center.

Outputs: `covers/<release-id>/cand_1.jpg` through `cand_3.jpg`, raw model images,
settings/seed/timing records, `job.json`, `worker.log` and `maestro_*.log`.
Each run copies Maestro's config to the output folder and overrides its output
paths through the documented CLI; it never changes the owner's config.

The GPU must remain below 10% utilization for a full minute before **each**
candidate. The wait times out after 12 hours. During generation the worker
checks every five seconds and stops only its own generation if utilization
exceeds 50% and a new foreign GPU process appears or its allocated memory grows.
Windows reports process VRAM as N/A: the worker then checks Windows GPU Engine
counters to attribute utilization to a foreign process, stopping above 50%.
If counters cannot identify every foreign GPU process, it stops conservatively.
Counter collection may add several seconds to the polling interval. GPU sample
telemetry is retained as `gpu_samples.jsonl`.
This is cooperative polling, not a system-wide lock on other applications.

`covers/.worker-lock` prevents overlapping cover batches/UI workers. Its
`owner.json` records the worker PID. If power loss leaves a stale lock, confirm
that PID and its generation child have exited before removing only that lock
directory. Normal success and errors release the lock automatically.

Validation: `python -m unittest discover -s scripts/distrokid-covers -p test_covers.py`
(system Python with Pillow); `node --check` on the HTML script; repository
typecheck, tests and build. HTTP regression exercises candidate serving,
selection preserving unrelated metadata, status and path traversal rejection.

Bundled fonts and licenses come from Google Fonts:
[Noto Serif Georgian](https://github.com/google/fonts/tree/main/ofl/notoserifgeorgian)
and [Cormorant Garamond](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond).
Their unmodified variable fonts and respective OFL texts are in `fonts/`.

## New May cover concepts (2026-11-26)

The worker now configures stdout and stderr as UTF-8 with replacement, including
when redirected by a cp1252 scheduler. `--concepts maisi_new_concepts.json` with
`--release მაისი-თვრამეტი` generates only candidates 6, 7 and 8; normal night
batches still target 1–3. Existing candidates are skipped on every rerun. The
concept file is validated before acquiring the worker lock. A failed job releases
its lock; after a forcibly killed process, use the existing stale-lock recovery
instructions and confirm its owner PID has exited before removing the lock.

Use `python scripts/distrokid-covers/install.py --worker-only` to install just
the worker with hash guards and a timestamped backup. This preserves the newer
installed photo-style/cover_scene behavior and leaves local UI files alone.

After generation, `review_new.py --folder <cover-folder> --font <Georgian-font>`
validates the 3000×3000 RGB JPEGs, creates `_choose_cover_new.jpg` with large
6/7/8 labels and records `validation_new.json`. It refuses to replace an existing
review sheet. No release cover is selected, and no upload is performed.
