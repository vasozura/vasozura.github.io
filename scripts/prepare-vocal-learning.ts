import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignLyricsToNotes } from "../src/karaoke/lyrics-alignment";
import type { ExtractedVocalNote, KaraokeArtifactManifest, KaraokeChord, KaraokeExportKey, KaraokeRenderManifest } from "../src/karaoke/contracts";
import { createChordedLyrics, createLrc, createMidi, createPresetAss, createRenderManifest, createSrt, karaokePresets, karaokePresetSlug } from "../src/karaoke/exports";
import { buildKaraokeFfmpegArgs } from "../src/karaoke/video-render";
import { encodeWav, guideSampleMidis, renderGuideTrack, type GuideSample } from "../src/karaoke/guide-audio";
import { instrumentSampleBank, instrumentSampleDirectory } from "../src/audio/sample-instrument";
import { cleanVocalNotes, createContinuousLearningNotes, createLearningNotes, maximumInternalSilenceMs } from "../src/karaoke/vocal-midi";
import { resolveMelodySource } from "../src/karaoke/melody-source";
import type { KaraokeRenderSummary } from "../src/karaoke/contracts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const required = (name: string): string => { const value = argument(name); if (!value) throw new Error(`--${name}=... is required`); return path.resolve(value); };
const executable = (name: string, fallback: string): string => argument(name) ?? fallback;
const run = (command: string, args: string[]): void => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}`);
};
const capture = (command: string, args: string[]): Buffer => {
  const result = spawnSync(command, args, { shell: false, maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}: ${result.stderr?.toString().slice(0, 400)}`);
  return result.stdout;
};
const guideSampleRate = 44100;

/** Decode one bank sample to mono float PCM at the guide sample rate. */
function decodeSample(ffmpeg: string, file: string): Float32Array {
  const raw = capture(ffmpeg, ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(guideSampleRate), "-"]);
  const aligned = Uint8Array.from(raw.subarray(0, Math.floor(raw.length / 4) * 4));
  return new Float32Array(aligned.buffer);
}

function mediaSeconds(ffprobe: string, file: string): number {
  const probe = JSON.parse(capture(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", file]).toString()) as { format?: { duration?: string } };
  const seconds = Number(probe.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read the duration of ${path.basename(file)}.`);
  return seconds;
}

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
  const ffprobe = argument("ffprobe") ?? (argument("ffmpeg") ? path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe");
  await mkdir(output, { recursive: true });
  const rawNotesFile = path.join(output, "raw-vocal-notes.json");
  if (process.argv.includes("--force-analysis") || !(await readFile(rawNotesFile).then(() => true, () => false))) {
    const pythonArgs = python.toLowerCase().endsWith("py.exe") || path.basename(python).toLowerCase() === "py" ? ["-3.11"] : [];
    run(python, [...pythonArgs, path.join(scriptDirectory, "audio-to-vocal-notes.py"), "--audio", audio, "--output", output, "--ffmpeg", ffmpeg, "--stems", argument("stems") ?? "auto"]);
  }
  const raw = JSON.parse(await readFile(rawNotesFile, "utf8")) as { sourceAudioSha256: string; notes: ExtractedVocalNote[]; stemSeparation?: boolean; analysis?: string };
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
  const presets = (argument("presets") ?? karaokePresets.join(",")).split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = karaokePresets.find((preset) => preset === item || karaokePresetSlug(preset) === item);
    if (!match) throw new Error(`Unknown --presets value "${item}". Use ${karaokePresets.join(", ")} or ${karaokePresets.map(karaokePresetSlug).join(", ")}.`);
    return match;
  });
  if (!presets.length) throw new Error("--presets selected no layout.");
  const background = ((): KaraokeRenderManifest["background"]["kind"] => {
    const value = argument("background") ?? (cover ? "image" : "dark-gradient");
    if (value !== "image" && value !== "cover-blur" && value !== "dark-gradient") throw new Error("--background must be image, cover-blur or dark-gradient.");
    if (value !== "dark-gradient" && !cover) throw new Error(`--background=${value} needs --cover=...`);
    return value;
  })();
  // 16:9 keeps its original unsuffixed names so previously generated artifacts stay addressable.
  const assName = (preset: KaraokeRenderManifest["preset"]): string => preset === "youtube-16:9" ? "lyrics.ass" : `lyrics-${karaokePresetSlug(preset)}.ass`;
  const mp4Name = (preset: KaraokeRenderManifest["preset"], guide?: "piano" | "guitar"): string => `karaoke-${karaokePresetSlug(preset)}${guide ? `-guide-${guide}` : ""}.mp4`;
  const guide = ((): "piano" | "guitar" | null => {
    const value = argument("guide");
    if (!value) return null;
    if (value !== "piano" && value !== "guitar") throw new Error("--guide must be piano or guitar.");
    return value;
  })();
  const presetKey = (base: "ass" | "mp4" | "mp4Guide", preset: KaraokeRenderManifest["preset"]): KaraokeExportKey =>
    (preset === "youtube-16:9" ? base : `${base}${preset === "shorts-9:16" ? "Shorts" : "Square"}`) as KaraokeExportKey;
  const exportNames = { vocalMidi: "vocal-melody.mid", learningMidi: "learning-melody.mid", lyricsMidi: "learning-melody-lyrics.mid", chordMidi: "chords.mid", studyMidi: "full-study.mid", lrc: "lyrics.lrc", srt: "lyrics.srt", chordedText: "chorded-lyrics.txt" } as const;
  await Promise.all([
    writeFile(path.join(exportDirectory, exportNames.vocalMidi), createMidi(originalNotes, null, { bpm, trackName: "Vocal Melody", provenance: "MP3 Vocal Extraction" })),
    writeFile(path.join(exportDirectory, exportNames.learningMidi), createMidi(continuousNotes, null, { bpm, trackName: "Continuous Learning Melody", provenance: "MP3 Vocal Extraction · continuous study representation" })),
    writeFile(path.join(exportDirectory, exportNames.lyricsMidi), createMidi(originalNotes, aligned.alignment, { bpm, trackName: "Learning Melody + Lyrics", provenance: "MP3 Vocal Extraction · authoritative song.lyrics", includeLyrics: true })),
    writeFile(path.join(exportDirectory, exportNames.chordMidi), createMidi(harmonyNotes, null, { bpm, trackName: "Chord Timeline", provenance: "Deterministic audio analysis · review required" })),
    writeFile(path.join(exportDirectory, exportNames.studyMidi), createMidi([...continuousNotes, ...harmonyNotes], aligned.alignment, { bpm, trackName: "Full Study", provenance: "MP3 Vocal Extraction · authoritative song.lyrics · analyzed harmony", includeLyrics: true })),
    writeFile(path.join(exportDirectory, exportNames.lrc), createLrc(aligned.alignment), "utf8"),
    writeFile(path.join(exportDirectory, exportNames.srt), createSrt(aligned.alignment), "utf8"),
    writeFile(path.join(exportDirectory, exportNames.chordedText), createChordedLyrics(aligned.alignment, chords), "utf8"),
    // Each layout gets its own subtitle file: PlayRes and margins must match the frame it is burned into.
    ...presets.map((preset) => writeFile(path.join(exportDirectory, assName(preset)), createPresetAss(aligned.alignment, chords, preset), "utf8")),
  ]);
  const artifactExports: Partial<Record<KaraokeExportKey, string>> = Object.fromEntries(Object.entries(exportNames).map(([key, value]) => [key, `./exports/${value}`]));
  for (const preset of presets) artifactExports[presetKey("ass", preset)] = `./exports/${assName(preset)}`;
  // The melody lane is decided once, here, and recorded in the manifest: the browser reads the
  // decision instead of making it, so the lane cannot change while a student is playing.
  const melody = resolveMelodySource([{ lane: "mp3-vocal", available: originalNotes.length > 0, noteCount: originalNotes.length, diagnostics: cleaned.diagnostics }]);
  const manifest: KaraokeArtifactManifest = {
    version: 1, songId, slug, generatedAt: new Date().toISOString(), sourceAudioSha256: sourceChecksum,
    melodySource: melody.label, sourceConfidence: melody.confidence,
    // originalUrl stays null on purpose: the canonical MP3 is served through a signed archive URL
    // that must never be written into a generated file. The browser supplies it at mount time.
    audio: { originalUrl: null, instrumentalUrl: null, vocalUrl: null },
    originalNotes, continuousNotes, alignment: aligned.alignment, chords, diagnostics: cleaned.diagnostics,
    exports: artifactExports,
    melody,
    guide: { instruments: originalNotes.length ? ["piano", "guitar"] : [], renderedInstrument: null, audioUrl: null },
    renders: [],
    provenance: {
      tool: "scripts/prepare-vocal-learning.ts",
      analysis: raw.analysis ?? "cached analysis",
      stemSeparation: raw.stemSeparation ?? true,
      lyricsSource: "song.lyrics",
      status: cleaned.diagnostics.status,
      notes: "Canonical audio is referenced by checksum only; its signed archive URL is supplied by the browser at mount time.",
    },
    timeline: { canonicalDurationSeconds: null, maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes) },
  };
  // manifest.json is written once at the end, after every render has contributed its export key.
  await Promise.all([
    writeFile(path.join(output, "vocal-midi.json"), `${JSON.stringify({ version: 1, notes: originalNotes, diagnostics: cleaned.diagnostics }, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "learning-melody.json"), `${JSON.stringify({ version: 1, original: originalNotes, continuous: continuousNotes, maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes) }, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "lyrics-alignment.json"), `${JSON.stringify(aligned.alignment, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "chords.json"), `${JSON.stringify({ version: 1, chords }, null, 2)}\n`, "utf8"),
  ]);
  // Without stem separation there is no instrumental, so the canonical MP3 carries the video and
  // the guide mix. The manifest records which one was used rather than implying an instrumental.
  const instrumentalFile = path.join(output, "instrumental.mp3");
  const hasInstrumental = await readFile(instrumentalFile).then(() => true, () => false);
  const instrumental = hasInstrumental ? instrumentalFile : audio;
  const renderAudioKind = hasInstrumental ? "instrumental" as const : "original" as const;
  const renders = presets.map((preset) => ({
    preset,
    file: path.join(exportDirectory, mp4Name(preset)),
    manifest: createRenderManifest(manifest, { preset, audioSource: instrumental, audioKind: renderAudioKind, backgroundKind: background, backgroundSource: cover, subtitleSource: path.join(exportDirectory, assName(preset)) }),
  }));
  const primary = renders.find((render) => render.preset === "youtube-16:9") ?? renders[0];
  await Promise.all([
    writeFile(path.join(output, "karaoke-render.json"), `${JSON.stringify(primary.manifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "karaoke-renders.json"), `${JSON.stringify({ version: 1, renders: renders.map((render) => ({ preset: render.preset, file: `./exports/${path.basename(render.file)}`, manifest: render.manifest })) }, null, 2)}\n`, "utf8"),
  ]);
  // The guide mix uses the original (not continuous) melody, because it plays against the
  // canonical instrumental and must land on the real vocal timing.
  let guideAudio: string | null = null;
  let guideReport: Record<string, unknown> | null = null;
  if (guide) {
    const bank = instrumentSampleBank(guide);
    const directory = path.join(scriptDirectory, "..", "public", "audio", instrumentSampleDirectory[guide]);
    const samples: GuideSample[] = guideSampleMidis(originalNotes, bank).map((sample) => ({ midi: sample.midi, pcm: decodeSample(ffmpeg, path.join(directory, sample.file)) }));
    const track = renderGuideTrack(originalNotes, samples, bank, { sampleRate: guideSampleRate, totalSeconds: mediaSeconds(ffprobe, instrumental), gain: Number(argument("guide-gain") ?? 1) });
    const wav = path.join(output, `guide-${guide}.wav`);
    await writeFile(wav, encodeWav(track.pcm, guideSampleRate));
    guideAudio = path.join(output, `instrumental-guide-${guide}.mp3`);
    // normalize=0 keeps amix from halving the instrumental; the guide already sits below it.
    run(ffmpeg, ["-y", "-loglevel", "error", "-i", instrumental, "-i", wav, "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]", "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", guideAudio]);
    artifactExports.guideAudio = `./${path.basename(guideAudio)}`;
    guideReport = { instrument: guide, samples: samples.length, missingSamples: track.missingSamples, normalizedBy: Number(track.normalizedBy.toFixed(4)), peakAmplitude: Number(track.peakAmplitude.toFixed(4)) };
  }
  const renderSummaries: KaraokeRenderSummary[] = [];
  const summarise = (render: KaraokeRenderManifest, exportKey: KaraokeExportKey, file: string): KaraokeRenderSummary =>
    ({ preset: render.preset, width: render.width, height: render.height, background: render.background.kind, audio: render.audio.kind, guide: render.audio.guide ?? null, exportKey, file: `./exports/${path.basename(file)}` });
  const rendered: string[] = [];
  if (!process.argv.includes("--skip-video")) {
    for (const render of renders) {
      run(ffmpeg, buildKaraokeFfmpegArgs(render.manifest, { outputFile: render.file }));
      artifactExports[presetKey("mp4", render.preset)] = `./exports/${path.basename(render.file)}`;
      renderSummaries.push(summarise(render.manifest, presetKey("mp4", render.preset), render.file));
      rendered.push(path.basename(render.file));
    }
    if (guide && guideAudio) {
      for (const render of renders) {
        const file = path.join(exportDirectory, mp4Name(render.preset, guide));
        const guideManifest: KaraokeRenderManifest = { ...render.manifest, audio: { kind: "instrumental-guide", source: guideAudio, guide } };
        run(ffmpeg, buildKaraokeFfmpegArgs(guideManifest, { outputFile: file }));
        artifactExports[presetKey("mp4Guide", render.preset)] = `./exports/${path.basename(file)}`;
        renderSummaries.push(summarise(guideManifest, presetKey("mp4Guide", render.preset), file));
        rendered.push(path.basename(file));
      }
    }
  }
  const completed: KaraokeArtifactManifest = {
    ...manifest,
    exports: artifactExports,
    audio: { ...manifest.audio, instrumentalUrl: hasInstrumental ? "./instrumental.mp3" : null, vocalUrl: (raw.stemSeparation ?? true) ? "./vocal.mp3" : null },
    guide: { instruments: originalNotes.length ? ["piano", "guitar"] : [], renderedInstrument: guide, audioUrl: guideAudio ? `./${path.basename(guideAudio)}` : null },
    renders: renderSummaries,
    timeline: { canonicalDurationSeconds: Number(mediaSeconds(ffprobe, audio).toFixed(3)), maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes) },
  };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ slug, melody: melody.lane, stemSeparation: completed.provenance!.stemSeparation, instrumental: hasInstrumental, notes: cleaned.diagnostics.noteCount, confidence: cleaned.diagnostics.pitchConfidence, status: cleaned.diagnostics.status, maxInternalSilenceMs: maximumInternalSilenceMs(continuousNotes), lyricsPreserved: manifest.alignment.authoritativeText === authoritativeText, background, presets, guide: guideReport, rendered, output }));
}

prepare().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
