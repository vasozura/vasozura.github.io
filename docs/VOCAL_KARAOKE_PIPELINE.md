# Vocal and Karaoke Preparation

The Vocal and Karaoke feature uses the archive MP3 and `song.lyrics` as its authoritative sources. Heavy audio analysis runs once on an owner-controlled local machine. A normal song page never performs stem separation or pitch extraction and remains usable when prepared artifacts are absent.

## Local requirements

- Python 3.11.
- librosa for pYIN pitch tracking and chroma analysis. **Required.** librosa is ISC licensed.
- Demucs for four-stem separation. **Optional** — see "Preparing without stem separation" below. Demucs source is MIT licensed; model weights retain their published model terms.
- FFmpeg and ffprobe for derived audio and MP4 rendering. The applicable FFmpeg license depends on the installed build and enabled codecs.
- Project dependencies installed with `pnpm install --frozen-lockfile`.
- Playwright, only for the optional browser check: `pnpm add -D playwright && pnpm exec playwright install chromium`. Playwright is Apache-2.0 licensed and is not a dependency of the app.

No service-role key, user token, or database password is required to prepare a song; credentials are needed only to publish the result (see "Delivery"). Temporary Demucs stems stay under the chosen ignored output directory. Analysis results are cached as `raw-vocal-notes.json` and `raw-chords.json` in that directory and reused on the next run unless `--force-analysis` is passed. Only explicitly reviewed final artifacts should be uploaded or committed.

## Prepare one song

```powershell
pnpm prepare:vocal -- --audio="C:\path\canonical.mp3" --lyrics="C:\path\lyrics.txt" --cover="C:\path\cover.jpg" --output="tmp\karaoke\song-slug" --slug=song-slug --song-id=<song-uuid> --bpm=120 --python=py --ffmpeg="C:\ffmpeg\bin\ffmpeg.exe"
```

Optional render flags, all defaulting to the previous single-video behaviour when omitted:

- `--presets=youtube-16:9,shorts-9:16,square-1:1` selects which layouts to render. The default renders all three.
- `--background=cover-blur|image|dark-gradient` chooses the backdrop. `cover-blur` keeps the whole artwork visible inside a portrait or square frame by filling the edges with a blurred, darkened copy; `image` crops the artwork to the frame; `dark-gradient` needs no cover at all and is used automatically when `--cover` is absent.
- `--guide=piano|guitar` additionally renders an offline guide mix, and `--guide-gain=<0..1>` sets how loud the guide sits under the instrumental.
- `--ffprobe="C:\ffmpeg\bin\ffprobe.exe"` when ffprobe is not beside the resolved `--ffmpeg` binary.
- `--stems=auto|require|skip` controls stem separation; see below.

The command verifies the canonical MP3 checksum, separates `vocals`, `bass`, `drums`, and `other`, creates a non-vocal instrumental, tracks vocal pitch with pYIN, removes short glitches and low-confidence octave errors, and writes both authentic and continuous melody representations. The continuous representation begins at study time zero and retains no internal gap over 30 ms. It never modifies the canonical audio or source note timing.

### Preparing without stem separation

`--stems=auto` (the default) uses Demucs when it is installed and otherwise tracks pitch on the canonical mix; `--stems=require` fails rather than falling back; `--stems=skip` always uses the mix. Without stems there is no `vocal.mp3` and no `instrumental.mp3`, so the browser marks Instrumental and Instrumental + Guide as not prepared, the rendered videos carry the canonical audio, and `manifest.provenance.stemSeparation` is `false`.

The mix path is fully supported but always review-grade: accompaniment leaks into the pitch track and pYIN can lock onto an octave of the accompaniment rather than the voice, which shows up as a low `pitchConfidence`, a `review` diagnostics status and a `review` melody confidence. Prefer stems for anything that will be published as verified.

Generated artifacts include:

- `vocal.mp3` and `instrumental.mp3`;
- `vocal-melody.mid`;
- `learning-melody.mid`;
- `learning-melody-lyrics.mid` with standard MIDI Lyric events;
- `learning-melody.json`, `lyrics-alignment.json`, and `raw-chords.json`;
- LRC, SRT, chorded lyric text, and one ASS subtitle file per requested layout;
- one karaoke MP4 per requested layout, plus `instrumental-guide-<instrument>.mp3` and one guide MP4 per layout when `--guide` is used;
- `karaoke-render.json` for the 16:9 render, unchanged in shape, and `karaoke-renders.json` listing every deterministic render manifest.

Subtitle type size and margins scale with the narrow edge of the frame, so a 9:16 or 1:1 export carries the same optical weight as 16:9; the 1920x1080 defaults are byte-identical to the original header. Every artifact is recorded in `manifest.json` under its own export key, and the browser lists those keys generically, so a new layout appears as a download without any UI change. The guide mix is synthesised from the same sample banks and the same envelope the browser guide uses, and lands on the original vocal timing rather than the continuous study timing.

## Lyric timing

Timing has two sources, in this order.

### 1. The generator's own alignment (preferred)

A song rendered by Suno can be timed by Suno. The generation's `aligned_lyrics` endpoint returns the written lyric one token per word, each with the seconds it is sung in that exact render - a measurement of the recording rather than a guess about it - and `src/karaoke/suno-timeline.ts` turns that payload into the shared timeline.

Two things are derived and nothing else. Line grouping, because the payload carries no line field: the newlines and `[section]` markers Suno embedded inside the token text are put back together and cut into lines, with markers and `---` separators kept out of the sung text and recorded as sections. And the end of a highlight, when a vocal-phrase file is supplied: a word may then be cut back to the end of the singing instead of held across a silence. A word whose Suno onset falls outside verified singing keeps its text and its place in the line but is given no duration, so nothing is ever lit while nobody is singing. A local acoustic window never moves or invents a Suno onset; it may only shorten an ending.

The authored poem is untouched. It stays in `alignment.authoritativeText`, and a sung line is marked `canonical` only when it is that poem's line word for word; every repeat, answer, hold and ad-lib the performance adds is carried as a `performance` line and written to `performance-lyrics.txt` beside the manifest. Karaoke follows the performance; the Full lyrics disclosure shows the poem.

```powershell
pnpm import:suno -- --input="tmp\karaoke\song-slug" --aligned="tmp\suno\aligned_lyrics.json" `
                    --phrases="tmp\song-vocal-phrases.json" --output="tmp\suno\corrected"
```

The run fails if the authored text changed by so much as a character, or if any authored line is absent from the aligned lyrics - which is what catches an alignment fetched for the wrong generation. Chords are re-anchored and melody notes re-attached to the line, word and syllable sounding at their own start.

Fetching the payload is a manual step and stays outside this repository: `aligned_lyrics` needs a signed-in session token, and no credential is read, logged or stored by any script here. Save the response to a file and pass that file.

### 2. Phrase alignment from the vocal stem (fallback)

When there is no generator alignment, lyric timing is built from the singing, not from the extracted melody. `scripts/vocal-phrases.py` reads the isolated vocal stem and reports the sung phrases - the stretches where a voice is present - and the onsets inside them; `src/karaoke/phrase-alignment.ts` then lays the authoritative text over sung time only, matching text to phrasing as a whole so that one phrase can carry several lines the singer ran together and one line can span several phrases when a rest breaks it at a caesura. Because every block starts at a real phrase start, an error cannot travel past the next breath, which is what stops timing drifting through a song.

Instrumental gaps are skipped rather than filled, and a line stops when its own phrase stops, so nothing stays highlighted over a rest. Word starts are snapped to detected onsets where one sits close to the proportional estimate. Syllable timing remains an estimate inside a word and is always marked review-grade.

`pnpm prepare:vocal` uses this automatically when a vocal stem is present, and falls back to the note-based aligner when a song was prepared without stems (`--skip-phrases` forces the fallback, `--vocal-stem=` points at a stem elsewhere). To correct an already prepared song without re-running the analysis:

```powershell
pnpm realign:karaoke -- --input="tmp\karaoke\song-slug" --stem="tmp\karaoke\song-slug\stems\htdemucs\audio\vocals.wav"
```

Only timing changes: the lyric text is never rewritten, and the run fails if it differs by so much as a character. Chords keep their own times and are re-anchored to the word sounding at that moment; a chord that plays during an instrumental passage stays in the timeline but is left unanchored instead of being piled onto the nearest lyric.

### Checking it against the recording

```powershell
pnpm verify:karaoke:sync -- --phrases="tmp\song-vocal-phrases.json" --lyrics="C:\path\lyrics.txt"
pnpm verify:karaoke:sync -- --phrases="..." --manifest="tmp\karaoke\song-slug\manifest.json"
```

`scripts/verify-karaoke-sync.ts` scores an alignment against the audio rather than against itself. It fails a song whose lines start while nobody is singing, whose line starts sit more than 250 ms from the nearest sung attack, whose error grows between the first and last quarter of the song, whose syllable rate varies more than 3.5x across lines, or whose per-line syllable counts do not correlate with the attacks inside those lines. That last figure is the one that catches text sitting over the wrong singing while every other statistic looks tidy. **The browser QA proves the views agree with the timeline; only this proves the timeline agrees with the singer.**

## The manifest

`manifest.json` is the one file the browser reads, and it carries everything a session needs without re-running analysis: song identity and the canonical audio checksum; the authoritative lyric text with line, word and syllable timing and stable ids; the chord timeline anchored to word ids; both melody representations (`originalNotes` on canonical MP3 time, `continuousNotes` on study time); `diagnostics`; and one entry per generated artifact under `exports`.

Four fields describe the preparation itself:

- `melody` — the resolved melody lane (`manual`, `mp3-vocal`, `vocal-midi` or `inferred`), its confidence and the reason it won. The lane is decided once here, so the browser reads the decision rather than making it and a lane can never change mid-playback.
- `guide` — which guide instruments the browser can offer, and which one (if any) was baked into an offline `instrumental + guide` mix.
- `renders` — one summary per generated video: preset, pixel size, background kind, audio kind and its export key.
- `provenance` — the tool, the analysis path, whether stems were used, that lyrics came from `song.lyrics`, and the review status.

`audio.originalUrl` is deliberately `null`: the canonical MP3 is served through a signed archive URL that must never be written into a generated file, so the browser supplies it at mount time. These fields are optional in the type only so that manifests generated before they existed still load; every current run writes all of them.

The displayed lyric text is copied from the supplied `song.lyrics` export. Audio analysis contributes timing only. Automatic word and syllable timing and audio-derived chords are labelled for review until an owner saves corrections. MusicXML lyrics/harmony or MIDI lyric/harmony data should replace automatic timing when verified.

## Runtime integration

The browser probes `karaoke/<slug>/manifest.json`, or uses `learning_mapping.karaokeManifestUrl` when configured. Prepared controls reuse the canonical MP3 and expose Original, Instrumental, and Instrumental plus Guide modes, line/word/syllable highlighting, chord display, Piano/Guitar sample routing, tempo, transpose, target key, interactive lyric seeking, diagnostics, and downloads. Signed archive URLs remain in memory and are never copied into generated files or browser storage.

If no manifest exists, deterministic review timing keeps basic MP3 + authoritative-lyrics Karaoke available. The panel clearly marks Vocal MIDI, instrumental audio, and reviewed syllable alignment as not prepared; the existing MP3, lyrics, YouTube link, song detail, and interactive score remain unchanged.

## YouTube channel copies

Owner-channel audio may be downloaded to an ignored local reference directory for reconciliation or recovery. It must not overwrite an archive canonical MP3 and is never treated as checksum-equivalent without a binary or audio-identity verification. Canonical archive media remains the primary source.

## Release gate

```powershell
pnpm verify:karaoke
pnpm verify:karaoke -- --output=tmp\check --keep-frames --ffmpeg="C:\ffmpeg\bin\ffmpeg.exe"
```

`scripts/verify-karaoke-render.ts` renders one short MP4 for each of the nine layout/background combinations from synthetic inputs, probes what FFmpeg actually produced, and confirms with a Goertzel filter that a guide track built from the real sample bank sounds at the pitches it was asked for. It touches no song, no Supabase record and no published artifact, writes only into the ignored `tmp/` directory, and exits non-zero on any mismatch. `--keep-frames` also writes one PNG per combination for visual review.

```powershell
pnpm verify:karaoke:browser -- --input="tmp\karaoke\song-slug" --audio="C:\path\canonical.mp3"
```

`scripts/verify-karaoke-browser.ts` is the browser end-to-end check. It serves the repository through Vite, mounts the real karaoke module against a real prepared directory, plays the canonical MP3 and asserts what a person would otherwise watch for by hand: lyrics following playback, a seek that moves every view together, a lyric click that seeks without changing whether the song is playing, chords above the right word, guide instruments driving the piano and guitar visualizers, visibly distinct selected controls, and a page that never scrolls itself. It writes a screenshot of the panel to `tmp/karaoke-browser-check/karaoke.png`. Add `--headed` to watch it. Playwright must be installed; the check exits non-zero on any failed assertion.

## Delivery

```powershell
pnpm publish:karaoke:dry-run -- --input="tmp\karaoke\song-slug"
pnpm publish:karaoke -- --input="tmp\karaoke\song-slug" --include-video
```

`scripts/publish-karaoke-artifacts.ts` uploads one prepared directory to the `karaoke` Storage bucket under `<slug>/<canonical checksum prefix>/`, and writes the resulting manifest URL to `songs.learning_mapping.karaokeManifestUrl` — the single reference the song page reads. Rendered MP4s are excluded unless `--include-video` is passed, because the browser does not need them. The stored manifest lists only the artifacts that were actually uploaded, so no download link can point at a missing object.

The bucket is public for reads and admin-only for writes (`supabase/migrations/202609100001_karaoke_delivery.sql`). It has to be: the browser fetches `manifest.json` with a plain fetch and resolves every artifact inside it relative to that URL, which a signed URL cannot provide. The script therefore refuses to publish for a song that is not itself published, and verifies that the prepared alignment was built from the lyrics the song row currently holds. It never changes a song's publication state, files or lyrics.

Credentials come from the environment and never from an argument: **`SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** — a server-only service-role credential, the same pair `scripts/import-song.ts` uses. `--dry-run` needs neither and prints exactly what a real run would upload.
