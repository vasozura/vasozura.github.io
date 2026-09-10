/* Acoustic synchronisation check.
 *
 * The browser QA proves that every view agrees with the timeline. This proves that the timeline
 * agrees with the singer, which is a different question and the one the owner rejected the product
 * over. Every measurement here comes from the vocal stem, not from the alignment's own assumptions.
 *
 *   pnpm verify:karaoke:sync -- --phrases=tmp/taflis/vocal-phrases.json --lyrics=path/lyrics-ka.txt
 *   pnpm verify:karaoke:sync -- --phrases=... --manifest=prepared/manifest.json   (score an existing alignment)
 *
 * What it measures:
 *   - lines that start while nobody is singing (must be none: text must never run over a rest);
 *   - how far each line start sits from the nearest vocal onset;
 *   - whether that error grows through the song, which is what accumulated drift looks like;
 *   - syllable-rate dispersion, which catches text bunched into the wrong places even when every
 *     individual line looks plausible.
 * Exits non-zero when a threshold is missed. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KaraokeArtifactManifest, LyricAlignment } from "../src/karaoke/contracts";
import { splitSyllables } from "../src/karaoke/lyrics-alignment";
import { alignLyricsToPhrases, type VocalPhrase } from "../src/karaoke/phrase-alignment";

interface PhraseFile { durationSeconds: number; sungSeconds: number; phrases: VocalPhrase[]; onsets: number[] }

const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const quantile = (values: readonly number[], fraction: number): number => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.round(fraction * (ordered.length - 1))))];
};

export interface SyncScore {
  lines: number;
  linesStartingInSilence: number;
  linesWithoutOnset: number;
  medianOnsetOffsetMs: number;
  p90OnsetOffsetMs: number;
  driftMs: number;
  syllableRateMedian: number;
  syllableRateSpread: number;
  onsetToSyllableCorrelation: number;
  checkpoints: Array<{ at: string; seconds: number; line: string; offsetMs: number; inPhrase: boolean }>;
}

/** Score any alignment against the audio, so the old and the new one can be compared directly. */
export function scoreAlignment(alignment: LyricAlignment, analysis: PhraseFile): SyncScore {
  const { phrases, onsets } = analysis;
  const inPhrase = (time: number): boolean => phrases.some((phrase) => time >= phrase.start - 0.12 && time <= phrase.end + 0.12);
  const nearestOnset = (time: number): number => onsets.reduce((best, onset) => Math.abs(onset - time) < Math.abs(best - time) ? onset : best, onsets[0] ?? time);

  const offsets: number[] = [];
  const rates: number[] = [];
  const syllableCounts: number[] = [];
  const onsetCounts: number[] = [];
  let silence = 0;
  let withoutOnset = 0;
  for (const line of alignment.lines) {
    if (!inPhrase(line.startSeconds)) silence += 1;
    offsets.push(Math.abs(nearestOnset(line.startSeconds) - line.startSeconds) * 1000);
    if (!onsets.some((onset) => onset >= line.startSeconds && onset <= line.endSeconds)) withoutOnset += 1;
    const syllables = line.words.reduce((sum, word) => sum + Math.max(1, splitSyllables(word.text).length), 0);
    const seconds = Math.max(0.2, line.endSeconds - line.startSeconds);
    rates.push(syllables / seconds);
    syllableCounts.push(syllables);
    onsetCounts.push(onsets.filter((onset) => onset >= line.startSeconds && onset <= line.endSeconds).length);
  }
  // Each sung syllable is an attack, so a line holding N syllables should contain about N onsets.
  // A line placed over the wrong stretch of singing breaks that relationship even when the overall
  // structure looks tidy, which is why this is measured separately from the timing statistics.
  const correlate = (left: readonly number[], right: readonly number[]): number => {
    const meanLeft = left.reduce((sum, value) => sum + value, 0) / Math.max(1, left.length);
    const meanRight = right.reduce((sum, value) => sum + value, 0) / Math.max(1, right.length);
    let covariance = 0;
    let varianceLeft = 0;
    let varianceRight = 0;
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index] - meanLeft;
      const b = right[index] - meanRight;
      covariance += a * b; varianceLeft += a * a; varianceRight += b * b;
    }
    return covariance / Math.max(1e-9, Math.sqrt(varianceLeft * varianceRight));
  };
  const quarter = Math.max(1, Math.floor(alignment.lines.length / 4));
  const early = median(offsets.slice(0, quarter));
  const late = median(offsets.slice(-quarter));

  const points: Array<[string, number]> = [["opening", 0], ["early verse", .15], ["25%", .25], ["50%", .5], ["75%", .75], ["final", .95]];
  const checkpoints = points.map(([label, fraction]) => {
    const at = fraction * analysis.durationSeconds;
    const line = alignment.lines.reduce((best, item) => Math.abs(item.startSeconds - at) < Math.abs(best.startSeconds - at) ? item : best, alignment.lines[0]);
    return { at: label, seconds: Number(line.startSeconds.toFixed(2)), line: line.text.slice(0, 30), offsetMs: Math.round(Math.abs(nearestOnset(line.startSeconds) - line.startSeconds) * 1000), inPhrase: inPhrase(line.startSeconds) };
  });

  return {
    lines: alignment.lines.length,
    linesStartingInSilence: silence,
    linesWithoutOnset: withoutOnset,
    medianOnsetOffsetMs: Math.round(median(offsets)),
    p90OnsetOffsetMs: Math.round(quantile(offsets, .9)),
    driftMs: Math.round(late - early),
    syllableRateMedian: Number(median(rates).toFixed(2)),
    // p90/p10: a song sung at a roughly steady rate stays near 1. Text bunched into the wrong
    // places shows up here even when each line looks individually plausible.
    syllableRateSpread: Number((quantile(rates, .9) / Math.max(.01, quantile(rates, .1))).toFixed(2)),
    onsetToSyllableCorrelation: Number(correlate(syllableCounts, onsetCounts).toFixed(3)),
    checkpoints,
  };
}

function main(): number {
  const phrasesFile = argument("phrases");
  if (!phrasesFile) throw new Error("--phrases=<vocal-phrases.json from scripts/vocal-phrases.py> is required.");
  const analysis = JSON.parse(readFileSync(path.resolve(phrasesFile), "utf8")) as PhraseFile;
  const manifestFile = argument("manifest");
  const lyricsFile = argument("lyrics");

  let alignment: LyricAlignment;
  let label: string;
  if (manifestFile) {
    alignment = (JSON.parse(readFileSync(path.resolve(manifestFile), "utf8")) as KaraokeArtifactManifest).alignment;
    label = "existing manifest alignment";
  } else if (lyricsFile) {
    const text = readFileSync(path.resolve(lyricsFile), "utf8");
    const rebuilt = alignLyricsToPhrases({ authoritativeText: text, phrases: analysis.phrases, onsets: analysis.onsets, durationSeconds: analysis.durationSeconds });
    alignment = rebuilt.alignment;
    label = "phrase-anchored alignment";
    console.log(JSON.stringify({ rebuilt: rebuilt.diagnostics }));
    const emit = argument("emit");
    if (emit) writeFileSync(path.resolve(emit), `${JSON.stringify(rebuilt.alignment, null, 2)}\n`, "utf8");
  } else {
    throw new Error("Pass --lyrics=<authoritative text> to score a fresh alignment, or --manifest=<manifest.json> to score an existing one.");
  }

  const score = scoreAlignment(alignment, analysis);
  console.log(`\n${label}`);
  console.table(score.checkpoints);
  const { checkpoints: _unused, ...summary } = score;
  console.table([summary]);

  // Thresholds: a line must never start in silence, a quarter of a second is about the limit of
  // what reads as "on the beat", and the error must not grow through the song.
  const failures: string[] = [];
  if (score.linesStartingInSilence > 0) failures.push(`${score.linesStartingInSilence} line(s) start while nobody is singing`);
  if (score.medianOnsetOffsetMs > 250) failures.push(`median line start sits ${score.medianOnsetOffsetMs} ms from the nearest sung onset`);
  if (Math.abs(score.driftMs) > 250) failures.push(`the error grows by ${score.driftMs} ms between the first and last quarter`);
  if (score.onsetToSyllableCorrelation < 0.35) failures.push(`syllable counts and sung attacks agree only at r=${score.onsetToSyllableCorrelation}, so lines sit over the wrong singing`);
  if (score.syllableRateSpread > 3.5) failures.push(`syllable rate varies ${score.syllableRateSpread}x across lines, so text is bunched`);
  if (failures.length) { console.error(`\nFAIL: ${failures.join("; ")}`); return 1; }
  console.log("\nAcoustic synchronisation within tolerance.");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("verify-karaoke-sync.ts")) {
  try { process.exitCode = main(); } catch (error: unknown) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
