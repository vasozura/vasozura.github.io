import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaraokeArtifactManifest, LyricAlignment } from "../src/karaoke/contracts";
import { alignLyricsToPhrases } from "../src/karaoke/phrase-alignment";
import { fitMidiToStemMapping, parseSunoVocalMidi } from "../src/karaoke/suno-midi-timing";

const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const required = (name: string): string => { const value = argument(name); if (!value) throw new Error(`--${name}=... is required`); return path.resolve(value); };
const audioDuration = (file: string): number => {
  const result = spawnSync(argument("ffprobe") ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr.trim()}`);
  const seconds = Number(result.stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error("Could not determine canonical audio duration.");
  return seconds;
};

async function main(): Promise<void> {
  const manifestFile = required("manifest");
  const lyricsFile = required("lyrics");
  const midiFile = required("midi");
  const audioFile = required("audio");
  const stemPhrasesFile = required("stem-phrases");
  const vocalStemFile = required("vocal-stem");
  const output = path.dirname(manifestFile);
  const [manifestRaw, lyricsRaw, midiBytes, audioBytes, stemPhrasesBytes, vocalStemBytes] = await Promise.all([
    readFile(manifestFile, "utf8"), readFile(lyricsFile, "utf8"), readFile(midiFile), readFile(audioFile), readFile(stemPhrasesFile), readFile(vocalStemFile),
  ]);
  const manifest = JSON.parse(manifestRaw) as KaraokeArtifactManifest;
  const pureMidiAlignment = manifest.alignment;
  const checksum = createHash("sha256").update(audioBytes).digest("hex");
  if (checksum !== manifest.sourceAudioSha256) throw new Error("Canonical audio checksum does not match the pilot manifest.");
  const authoritativeText = lyricsRaw.replace(/\r\n/g, "\n").trim();
  const timing = parseSunoVocalMidi(midiBytes, { audioDurationSeconds: audioDuration(audioFile) });
  const stem = JSON.parse(stemPhrasesBytes.toString("utf8")) as { durationSeconds: number; phrases: Array<{ start: number; end: number }>; onsets: number[] };
  const mapping = fitMidiToStemMapping({ midiOnsets: timing.onsets, stemOnsets: stem.onsets, midiDurationSeconds: timing.durationSeconds, audioDurationSeconds: stem.durationSeconds, vocalRegions: timing.vocalRegions });
  const stemBuilt = alignLyricsToPhrases({ authoritativeText, phrases: stem.phrases, onsets: stem.onsets, durationSeconds: stem.durationSeconds });
  const nearest = (values: number[], value: number): number => values.reduce((best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best, values[0]);
  const insideStem = (time: number): boolean => stem.phrases.some((phrase) => time >= phrase.start - 0.12 && time <= phrase.end + 0.12);
  const mappedMidiOnsets = timing.onsets.map((time) => ({ midi: time, audio: mapping.map(time) }));

  let midiImprovedStarts = 0;
  const hybridLines = stemBuilt.alignment.lines.map((line, index, lines) => {
    const candidate = mappedMidiOnsets.reduce((best, item) => Math.abs(item.audio - line.startSeconds) < Math.abs(best.audio - line.startSeconds) ? item : best);
    const baselineOffset = Math.abs(nearest(stem.onsets, line.startSeconds) - line.startSeconds);
    const candidateOffset = Math.abs(nearest(stem.onsets, candidate.audio) - candidate.audio);
    const previousEnd = index ? lines[index - 1].endSeconds : -Infinity;
    const valid = Math.abs(candidate.audio - line.startSeconds) <= 0.6 && insideStem(candidate.audio) && candidateOffset + 0.001 < baselineOffset && candidate.audio >= previousEnd && candidate.audio < line.endSeconds;
    if (!valid) return line;
    midiImprovedStarts += 1;
    const shift = candidate.audio - line.startSeconds;
    return { ...line, startSeconds: Number(candidate.audio.toFixed(3)), words: line.words.map((word) => ({ ...word, startSeconds: Number((word.startSeconds + shift).toFixed(3)), endSeconds: Number((word.endSeconds + shift).toFixed(3)), syllables: word.syllables.map((syllable) => ({ ...syllable, startSeconds: Number((syllable.startSeconds + shift).toFixed(3)), endSeconds: Number((syllable.endSeconds + shift).toFixed(3)) })) })) };
  });
  const hybridAlignment: LyricAlignment = { ...stemBuilt.alignment, source: "suno-midi-vocal+stem-gated", lines: hybridLines };
  if (hybridAlignment.authoritativeText !== authoritativeText) throw new Error("Canonical lyrics changed during hybrid alignment.");
  for (let index = 0; index < hybridLines.length; index += 1) {
    const line = hybridLines[index];
    if (!insideStem(line.startSeconds)) throw new Error(`Hybrid lyric line ${index + 1} begins outside a stem vocal region.`);
    if (line.endSeconds <= line.startSeconds) throw new Error(`Hybrid lyric line ${index + 1} has a non-positive window.`);
    if (index && line.startSeconds < hybridLines[index - 1].endSeconds - 0.001) throw new Error(`Hybrid lyric lines ${index} and ${index + 1} overlap.`);
  }

  const sourceLines = authoritativeText.split("\n").map((text, index) => ({ text: text.trim(), sourceLine: index + 1 })).filter((line) => line.text && !/^\[[^\]\n]+\]$/.test(line.text));
  const originalFailures = pureMidiAlignment.lines.map((line, index) => ({ line, index })).filter(({ line }) => !insideStem(line.startSeconds));
  const originalDiagnosis = originalFailures.map(({ line, index }) => {
    const before = [...timing.onsets].filter((time) => time <= line.startSeconds).at(-1) ?? null;
    const after = timing.onsets.find((time) => time >= line.startSeconds) ?? null;
    const phrase = stem.phrases.reduce((best, item) => Math.min(Math.abs(item.start - line.startSeconds), Math.abs(item.end - line.startSeconds)) < Math.min(Math.abs(best.start - line.startSeconds), Math.abs(best.end - line.startSeconds)) ? item : best);
    const acousticOnset = nearest(stem.onsets, line.startSeconds);
    const mapped = mapping.map(line.startSeconds);
    const inRawMidiRegion = timing.vocalRegions.some((region) => line.startSeconds >= region.start && line.startSeconds <= region.end);
    const cause = insideStem(mapped) ? "MIDI/audio time offset" : inRawMidiRegion ? "MIDI false-positive activity or phrase allocation outside stem energy" : Math.abs(mapped - line.startSeconds) > 0.25 ? "section-boundary drift" : "phrase allocation";
    return { timedLine: index + 1, sourceLine: sourceLines[index]?.sourceLine ?? null, text: line.text, midiWindow: { start: line.startSeconds, end: line.endSeconds }, nearestMidiNotes: { before, after }, mappedStart: Number(mapped.toFixed(3)), nearestStemRegion: phrase, nearestAcousticOnset: acousticOnset, acousticOffsetMs: Math.round(Math.abs(acousticOnset - line.startSeconds) * 1000), cause };
  });

  manifest.generatedAt = new Date().toISOString();
  manifest.alignment = hybridAlignment;
  manifest.provenance = {
    ...(manifest.provenance ?? { tool: "scripts/apply-suno-midi-timing.ts", analysis: "", stemSeparation: true, lyricsSource: "song.lyrics", status: "review", notes: "" }),
    tool: "scripts/apply-suno-midi-timing.ts",
    analysis: "verified official Suno Lead Vocal MIDI structure with authoritative vocal-stem acoustic gating",
    notes: `Timing source suno-midi-vocal+stem-gated; MIDI improved ${midiImprovedStarts} stem boundary/boundaries; canonical audio and lyrics verified locally.`,
  };
  const diagnostics = {
    version: 2, timingSource: "suno-midi-vocal+stem-gated", midiFile: path.basename(midiFile), midiSha256: createHash("sha256").update(midiBytes).digest("hex"),
    stemPhrasesSha256: createHash("sha256").update(stemPhrasesBytes).digest("hex"), vocalStemSha256: createHash("sha256").update(vocalStemBytes).digest("hex"),
    audioSha256: checksum, durationSeconds: timing.durationSeconds, noteCount: timing.noteCount, phraseCount: timing.phrases.length,
    vocalRegions: timing.vocalRegions, instrumentalGaps: timing.instrumentalGaps,
    mapping: { scale: mapping.scale, offsetSeconds: mapping.offsetSeconds, anchors: mapping.anchors, pairCount: mapping.pairCount, medianResidualMs: mapping.medianResidualMs, p90ResidualMs: mapping.p90ResidualMs },
    midiImprovedStarts, retainedStemStarts: hybridLines.length - midiImprovedStarts, alignment: stemBuilt.diagnostics,
  };
  await Promise.all([
    writeFile(path.join(output, "lyrics-alignment.json"), `${JSON.stringify(hybridAlignment, null, 2)}\n`, "utf8"),
    writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "suno-midi-timing-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, "pure-midi-silence-diagnosis.json"), `${JSON.stringify({ version: 1, failures: originalDiagnosis }, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify(diagnostics));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
