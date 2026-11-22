# Local DistroKid covers — 2026-11-22

The installation package in `scripts/distrokid-covers/` adds the owner's local
**🎨 ყდის გენერაცია** button, candidate previews and **აირჩიე** actions, plus
`DistroKid/COVERS_NIGHT.bat`. Generation uses the installed Maestro/WanGP
`flux2_klein_9b` at 1024×1024, four steps/CFG 1, with no AI lettering. The
program composes RGB 3000×3000 JPGs with the existing round logo and bundled
OFL fonts: Noto Serif Georgian Bold or Cormorant Garamond Light in pale gold.

The original UI files were backed up under
`D:/Prog/YT_Upload/DistroKid/_covers_backup_20261122_205534`; the corrected
package was installed with another backup ending `_210033`. Exact source hashes
are recorded in the local `_covers_installed.json`. The installer detected
concurrent edits at 20:58; inspected and preserved the `needs_cover` flag,
`suggest/start_many` endpoint and batch-selection UI before installing fixes.

Both interactive and night runs use one cross-process cover-worker lock. They
wait for utilization below 10% for a full minute before each image, poll during
generation and stop only their own generation when foreign GPU work appears
above 50%. Windows virtual-environment Python can launch a second interpreter
process: the guard includes all descendants, covered by a regression. The
first trial stopped conservatively because it counted that interpreter as
foreign; it produced no candidate. A second trial encountered a newly started
ComfyUI context. Windows reports its process VRAM as N/A; the final guard uses
Windows GPU Engine counters to attribute actual utilization before stopping.
Verified counter samples show ComfyUI at 0% while the cover process reaches
83%. The owner's ComfyUI was not stopped. Samples are retained in the output
folder as `gpu_samples.jsonl`.

Visual review rejected the first completed artwork because Flux drew garbled
lyrics despite the negative instruction. That set and interrupted second render
are retained under `rejected_lettering_210808/`. The corrected prompt keeps the
existing visual style/subject but omits literal title/lyric copy and all
lettering instructions, translating a small set of lyrical keywords into visual
motifs locally. The title is drawn only by the compositor. This correction is
covered by the prompt regression.

Maestro's existing transformer, Qwen3 8B encoder and VAE are present. No model
or dependency was installed. The worker copies config into the external job
folder, overrides output paths through the documented CLI, and uses Hugging
Face/Transformers offline mode. Maestro code/config and WanGP settings were
not edited. No other GPU process was stopped.

The idle Upload Center reported no running YouTube upload before its existing
restart endpoint was used. Its live home response is HTTP 200 and contains the
Georgian generation button, clean Georgian labels and the preserved batch UI.
Seven Python regressions pass, covering lettering removal, both compositor
layouts, GPU interference/launcher descendants, the full idle minute, resumed
sets, HTTP candidate selection/metadata preservation/status and invalid paths.
The HTML script passes `node --check`. `pnpm typecheck`, all 456 tests and
`pnpm build` pass (invoked through `pnpm.cmd`; Vite tests/build needed the usual
sandbox child-process permission). The build's existing large-chunk advisory
remains; performance budgets pass.

The requested review release is `მაისი-თვრამეტი` (May the Eighteenth).
Outputs and logs live under
`D:/Prog/MusicToVideo/Library/_agent/distrokid/covers/მაისი-თვრამეტი/`.
Candidate preparation does not change the release JSON; only an explicit
candidate-selection action sets `cover`. No media was uploaded or published,
and no production database, portfolio/covers or OneDrive checkout was changed.

See the package README for operation, font sources/licenses and stale-lock
recovery. The night batch is provided for the existing scheduler; no Windows
scheduled task was registered.

## Completed review set, 21:13 +04

Final code commits: `53730fc`, `abbdc3d`, `cafd074`. The installed files match
the final source package; final installation backup ends `_210813`.

All three `cand_1.jpg`–`cand_3.jpg` decode as 3000×3000 RGB JPEGs, and their
live candidate endpoints return HTTP 200 with identical bytes. `validation.json`
in the output folder records sizes, SHA-256 hashes, seeds and timings:

| Candidate | Seed | Generation + composition seconds, excluding idle wait | Bytes |
| --- | ---: | ---: | ---: |
| 1 | 827277248 | 43.000 | 2,314,202 |
| 2 | 1855050091 | 43.563 | 2,493,965 |
| 3 | 2070426775 | 44.907 | 2,560,094 |

Visual review found no visible generated lettering in the replacement set;
the only title is the readable program-rendered Georgian title. Candidate 1
has a generated dark rectangular region at the upper right, retained as a
review variant; 2 and 3 have cleaner title backgrounds. The owner can choose
using the local release editor. No candidate was selected automatically: the
release's `cover` is still empty. The worker exited successfully and released
its lock. Final GPU sample was 0% utilization / 194 MiB; the owner's idle
ComfyUI remains running. No uploaded or published media.
