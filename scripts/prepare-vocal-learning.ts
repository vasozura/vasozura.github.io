import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignLyricsToNotes } from "../src/karaoke/lyrics-alignment";
import type { ExtractedVocalNote, KaraokeArtifactManifest, KaraokeChord } from "../src/karaoke/contracts";
import { createAss, createChordedLyrics, createLrc, createMidi, createRenderManifest, createSrt } from "../src/karaoke/exports";
import { cleanVocalNotes, createContinuousLearningNotes, createLearningNotes, maximumInternalSilenceMs } from "../src/karaoke/vocal-midi";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const required = (name: string): string => { const value = argument(name); if (!value) throw new Error(`--${name}=... is required`); return path.resolve(value); };
const executable = (name: string, fallback: string): string => argument(name) ?? fallback;
const run = (command: string, args: string[]): void => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}`);
};

async function sha256(filename: string): Promise<string> { return createHash("sha256").update(await readFile(filename)).digest("hex"); }

function chordEvents(raw: unknown): KaraokeChord[] {
  const value = raw as { chords?: Array<Record<string, unknown>> };
  return (value.chords ?? []).map((item, index) => ({ id: String(item.id ?? `analysis-${index}`), symbol: String(item.symbol ?? "N.C."), startSeconds: Number(item.startSeconds ?? 0), endSeconds: Number(item.endSeconds ?? 0), wordId: null, source: "analysis" }));
}

function chordMidiNotes(chords: KaraokeChord[]): ReturnType<typeof createLearningNotes> {
  const roots: Record<string, number> = { C: 48, "C♯": 49, D: 50, "E♭": 51, E: 52, F: 53, "F♯": 54, G: 55, "A♭": 56, A: 57, "B♭": 58, B: 59 };
  const notes: ExtractedVocalNote[] = [];
  for (const chord of chords) {
    const match = /^(C♯|E♭|F♯|A♭|B♭|[A-G])(m?)/.exec(chord.symbol);
    if (!match) continue;
    const root = roots[match[1]];
    const intervals = match[2] === "m" ? [0, 3, 7] : [0, 4, 7];
    intervals.forEach((interval, index) => notes.push({ id: `${chord.id}-${index}`, midi: root + interval, startSeconds: chord.startSeconds, durationSeconds: Math.max(.1, chord.endSeconds - chord.startSeconds), velocity: index ? .45 : .6, confidence: .7, pitchConfidence: .7, sourceTimestampSeconds: chord.startSeconds }));
  }
  return createLearningNotes(notes, "Deterministic chord analysis");
}

async function prepare(): Promise<void> {
  const audio = required("audio");
  const lyricsFile = required("lyrics");
  const output = required("output");
  const cover = argument("cover") ? path.resolve(argument("cover")!) : null;
  const slug = argument("slug") ?? path.basename(output);
  const songId = argument("song-id") ?? slug;
  const bpm = Number(argument("bpm") ?? 120);
  const python = executable("python", process.platform === "win32" ? "py" : "python3");
  const ffmpeg = executable("ffmpeg", "ffmpeg");
  await mkdir(output, { recursive: true });
  const rawNotesFile = path.join(output, "raw-vocal-notes.json");
  if (process.argv.includes("--force-analysis") || !(await readFile(rawNotesFile).then(() => true, () => false))) {
    const pythonArgs = python.toLowerCase().endsWith("py.exe") || path.basename(python).toLowerCase() === "py" ? ["-3.11"] : [];
    run(python, [...pythonArgs, path.join(scriptDirectory, "audio-to-vocal-notes.py"), "--audio", audio, "--output", output, "--ffmpeg", ffmpeg]);
  }
  const raw = JSON.parse(await readFile(rawNotesFile, "utf8")) as { sourceAudioSha256: string; notes: ExtractedVocalNote[] };
  const sourceChecksum = await sha256(audio);
  if (raw.sourceAudioSha256 !== sourceChecksum) throw new Error("Cached vocal analysis does not match the canonical MP3 checksum.");
  const authoritativeText = (await readFile(lyricsFile, "utf8")).replace(/\r\n/g, "\n").trim();
  const cleaned = cleanVocalNotes(raw.notes);
  const originals = createLearningNotes(cleaned.notes);
  const continuous = createContinuousLearningNotes(originals, 0.03);
  const aligned = alignLyricsToNotes(authoritativeText, originals, "deterministic-review");
  const alignedById = new Map(aligned.notes.map((note) => [note.learningId, note]));
  const originalNotes = originals.map((note) => ({ ...note, ...alignedById.get(note.learningId) }));
  const continuousNotes = continuous.map((note) => ({ ...note, lyricLineId: alignedById.get(note.learningId)?.lyricLineId ?? null, wordId: alignedById.get(note.learningId)?.wordId ?? null, syllableId: alignedById.get(note.learningId)?.syllableId ?? null }));
  const rawChords = chordEvents(JSON.parse(await readFile(path.join(output, "raw-chords.json"), "utf8")));
  const words = aligned.alignment.lines.flatMap((line) => line.words);
  const chords = rawChords.map((chord) => ({ ...chord, wordId: words.reduce<string | null>((best, word) => best === null || Math.abs(word.startSeconds - chord.startSeconds) < Math.abs(words.find((item) => item.id === best)!.startSeconds - chord.startSeconds) ? word.id : best, null) }));
  const exportDirectory = path.join(output, "exports");
  await mkdir(exportDirectory, { recursive: true });
  const harmonyNotes = chordMidiNotes(chords);
  const exportNames = { vocalMidi: "vocal-melody.mid", learningMidi: "learning-melody.mid", lyricsMidi: "learning-melody-lyrics.mid", chordMidi: "chords.mid", studyMidi: "full-study.mid", lrc: "lyrics.lrc", srt: "lyrics.srt", ass: "lyrics.ass", chordedText: "chorded-lyrics.txt", mp4: "karaoke-16x9.mp4" } as const;
  await Promise.all([
    writeFile(path.join(exportDirectory, exportNames.vocalMidi), createMidi(originalNotes, null, { bpm, trackName: "Vocal Melody", provenance: "MP3 Vocal Extraction" })),
    writeFile(path.join(exportDirectory, exportNames.learningMidi), createMidi(continuousNotes, null, { bpm, trackName: "Continuous Learning Melody", provenance: "MP3 Vocal Extraction · continuous study representation" })),
    writeFile(path.join(exportDirectory, exportNames.lyricsMidi), createMidi(originalNotes, aligned.alignment, { bpm, trackName: "Learning Melody + Lyrics", provenance: "MP3 Vocal Extraction · authoritative song.lyrics", includeLyrics: true })),
    writeFile(path.join(exportDirectory, exportNames.chordMidi), createMidi(harmonyNotes, null, { bpm, trackName: "Chord Timeline", provenance: "Deterministic audio analysis · review required" })),
    writeFile(path.join(exportDirectory, exportNames.studyMidi), createMidi([...continuousNotes, ...harmonyNotes], aligned.alignment, { bpm, trackName: "Full Study", provenance: "MP3 Vocal Extraction · authoritative song.lyrics · analyzed harmony", includeLyrics: true })),
    writeFile(path.join(exportDirectory, exportNames.lrc), createLrc(aligned.alignment), "utf8"),
    writeFile(path.join(exportDirectory, exportNames.srt), createSrt(aligned.alignment), "utf8"),
    writeFile(path.join(exportDirectory, exportNames.ass), createAss(aligned.alignment, chords), "utf8"),
    writeFile(path.join(exportDirectory, exportNames.chordedText), createChordedLyrics(aligned.alignment, chords), "utf8"),
  ]);
  const manifest: KaraokeArtifactManifest = {
    version: 1, songId, slug, generatedAt: new Date().toISOString(), sourceAudioSha256: sourceChecksum,
    melodySource: "MP3 Vocal Extraction", sourceConfidence: cleaned.diagnostics.status === "verified" ? "verified" : "review",
    audio: { originalUrl: null, instrumentalUrl: "./instrumental.mp3", vocalUrl: "./vocal.mp3" },
    originalNotes, continuousNotes, alignment: aligned.alignment, chords, diagnostics: cleaned.diagnostics,
    exports: Object.fromEntries(Object.entries(exportNames).map(([key, value]) => [key, `./exports/${value}`])) as KaraokeArtifactManifest["exports"],
  };
  await Promise.all([
    writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "vocal-midi.json"), `${JSON.stringify({ version: 1, notes: originalNotes, diagnostics: cleaned.diagnostics }, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "learning-melody.json"), `${JSON.stringify({ version: 1, original: originalNotes, continuous: continuousNotes, maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes) }, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "lyrics-alignment.json"), `${JSON.stringify(aligned.alignment, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "chords.json"), `${JSON.stringify({ version: 1, chords }, null, 2)}\n`, "utf8"),
  ]);
  const renderManifest = createRenderManifest(manifest, { preset: "youtube-16:9", audioSource: path.join(output, "instrumental.mp3"), audioKind: "instrumental", backgroundKind: cover ? "image" : "dark-gradient", backgroundSource: cover, subtitleSource: path.join(exportDirectory, exportNames.ass) });
  await writeFile(path.join(output, "karaoke-render.json"), `${JSON.stringify(renderManifest, null, 2)}\n`, "utf8");
  if (cover && !process.argv.includes("--skip-video")) {
    const filters = `scale=${renderManifest.width}:${renderManifest.height}:force_original_aspect_ratio=increase,crop=${renderManifest.width}:${renderManifest.height},ass='${path.join(exportDirectory, exportNames.ass).replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
    run(ffmpeg, ["-y", "-loglevel", "error", "-loop", "1", "-i", cover, "-i", path.join(output, "instrumental.mp3"), "-vf", filters, "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p", "-shortest", path.join(exportDirectory, exportNames.mp4)]);
  }
  console.log(JSON.stringify({ slug, notes: cleaned.diagnostics.noteCount, confidence: cleaned.diagnostics.pitchConfidence, status: cleaned.diagnostics.status, maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes), lyricsPreserved: manifest.alignment.authoritativeText === authoritativeText, output }));
}

prepare().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
