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

The command verifies the canonical MP3 checksum, separates `vocals`, `bass`, `drums`, and `other`, creates a non-vocal instrumental, tracks vocal pitch with pYIN, removes short glitches and low-confidence octave errors, and writes both authentic and continuous melody representations. The continuous representation begins at study time zero and retains no internal gap over 30 ms. It never modifies the canonical audio or source note timing.

Generated artifacts include:

- `vocal.mp3` and `instrumental.mp3`;
- `vocal-melody.mid`;
- `learning-melody.mid`;
- `learning-melody-lyrics.mid` with standard MIDI Lyric events;
- `learning-melody.json`, `lyrics-alignment.json`, and `raw-chords.json`;
- LRC, SRT, ASS, and chorded lyric text;
- an FFmpeg karaoke MP4 and its deterministic render manifest.

The displayed lyric text is copied from the supplied `song.lyrics` export. Audio analysis contributes timing only. Automatic word and syllable timing and audio-derived chords are labelled for review until an owner saves corrections. MusicXML lyrics/harmony or MIDI lyric/harmony data should replace automatic timing when verified.

## Runtime integration

The browser probes `karaoke/<slug>/manifest.json`, or uses `learning_mapping.karaokeManifestUrl` when configured. Prepared controls reuse the canonical MP3 and expose Original, Instrumental, and Instrumental plus Guide modes, line/word/syllable highlighting, chord display, Piano/Guitar sample routing, tempo, transpose, target key, interactive lyric seeking, diagnostics, and downloads. Signed archive URLs remain in memory and are never copied into generated files or browser storage.

If no manifest exists, deterministic review timing keeps basic MP3 + authoritative-lyrics Karaoke available. The panel clearly marks Vocal MIDI, instrumental audio, and reviewed syllable alignment as not prepared; the existing MP3, lyrics, YouTube link, song detail, and interactive score remain unchanged.

## YouTube channel copies

Owner-channel audio may be downloaded to an ignored local reference directory for reconciliation or recovery. It must not overwrite an archive canonical MP3 and is never treated as checksum-equivalent without a binary or audio-identity verification. Canonical archive media remains the primary source.
