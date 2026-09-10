# Vocal and Karaoke Preparation

The Vocal and Karaoke feature uses the archive MP3 and `song.lyrics` as its authoritative sources. Heavy audio analysis runs once on an owner-controlled local machine. A normal song page never performs stem separation or pitch extraction and remains usable when prepared artifacts are absent.

## Local requirements

- Python 3.11.
- Demucs for four-stem separation. Demucs source is MIT licensed; model weights retain their published model terms.
- librosa for pYIN pitch tracking and chroma analysis. librosa is ISC licensed.
- FFmpeg and ffprobe for derived audio and MP4 rendering. The applicable FFmpeg license depends on the installed build and enabled codecs.
- Project dependencies installed with `pnpm install --frozen-lockfile`.

No service-role key, user token, or database password is required. Temporary Demucs stems stay under the chosen ignored output directory. Only explicitly reviewed final artifacts should be uploaded or committed.

## Prepare one song

```powershell
pnpm prepare:vocal -- --audio="C:\path\canonical.mp3" --lyrics="C:\path\lyrics.txt" --cover="C:\path\cover.jpg" --output="tmp\karaoke\song-slug" --slug=song-slug --song-id=<song-uuid> --bpm=120 --python=py --ffmpeg="C:\ffmpeg\bin\ffmpeg.exe"
```

Optional render flags, all defaulting to the previous single-video behaviour when omitted:

- `--presets=youtube-16:9,shorts-9:16,square-1:1` selects which layouts to render. The default renders all three.
- `--background=cover-blur|image|dark-gradient` chooses the backdrop. `cover-blur` keeps the whole artwork visible inside a portrait or square frame by filling the edges with a blurred, darkened copy; `image` crops the artwork to the frame; `dark-gradient` needs no cover at all and is used automatically when `--cover` is absent.
- `--guide=piano|guitar` additionally renders an offline guide mix, and `--guide-gain=<0..1>` sets how loud the guide sits under the instrumental.
- `--ffprobe="C:\ffmpeg\bin\ffprobe.exe"` when ffprobe is not beside the resolved `--ffmpeg` binary.

The command verifies the canonical MP3 checksum, separates `vocals`, `bass`, `drums`, and `other`, creates a non-vocal instrumental, tracks vocal pitch with pYIN, removes short glitches and low-confidence octave errors, and writes both authentic and continuous melody representations. The continuous representation begins at study time zero and retains no internal gap over 30 ms. It never modifies the canonical audio or source note timing.

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
