import pkg from "@tonejs/midi";
import type { VocalPhrase } from "./phrase-alignment";

const { Midi } = pkg as unknown as typeof import("@tonejs/midi");

export interface SunoMidiTiming {
  durationSeconds: number;
  phrases: VocalPhrase[];
  onsets: number[];
  vocalRegions: VocalPhrase[];
  instrumentalGaps: VocalPhrase[];
  noteCount: number;
}

export interface MidiStemMapping {
  scale: number;
  offsetSeconds: number;
  anchors: Array<{ midiSeconds: number; correctionSeconds: number; pairCount: number }>;
  pairCount: number;
  medianResidualMs: number;
  p90ResidualMs: number;
  map(time: number): number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction))] : 0;
};

/** Fit MIDI time to the acoustic clock, then add smooth section-local corrections. */
export function fitMidiToStemMapping(input: {
  midiOnsets: number[];
  stemOnsets: number[];
  midiDurationSeconds: number;
  audioDurationSeconds: number;
  vocalRegions: VocalPhrase[];
}): MidiStemMapping {
  if (!input.midiOnsets.length || !input.stemOnsets.length) throw new Error("MIDI/stem mapping requires both MIDI and acoustic onsets.");
  let scale = input.audioDurationSeconds / input.midiDurationSeconds;
  let offsetSeconds = median(input.midiOnsets.slice(0, 24).map((time) => {
    const projected = time * scale;
    const nearest = input.stemOnsets.reduce((best, onset) => Math.abs(onset - projected) < Math.abs(best - projected) ? onset : best);
    return nearest - projected;
  }).filter((value) => Math.abs(value) <= 1.5));

  const makePairs = () => input.midiOnsets.map((midi) => {
    const projected = midi * scale + offsetSeconds;
    const stem = input.stemOnsets.reduce((best, onset) => Math.abs(onset - projected) < Math.abs(best - projected) ? onset : best);
    return { midi, stem, residual: stem - projected };
  }).filter((pair) => Math.abs(pair.residual) <= 0.75);
  let pairs = makePairs();
  for (let pass = 0; pass < 2; pass += 1) {
    const meanX = pairs.reduce((sum, pair) => sum + pair.midi, 0) / pairs.length;
    const meanY = pairs.reduce((sum, pair) => sum + pair.stem, 0) / pairs.length;
    const covariance = pairs.reduce((sum, pair) => sum + (pair.midi - meanX) * (pair.stem - meanY), 0);
    const variance = pairs.reduce((sum, pair) => sum + (pair.midi - meanX) ** 2, 0);
    scale = Math.max(0.98, Math.min(1.02, covariance / Math.max(1e-9, variance)));
    offsetSeconds = meanY - scale * meanX;
    pairs = makePairs();
  }

  const anchors = input.vocalRegions.map((region) => {
    const own = pairs.filter((pair) => pair.midi >= region.start && pair.midi <= region.end);
    return { midiSeconds: (region.start + region.end) / 2, correctionSeconds: median(own.map((pair) => pair.stem - (pair.midi * scale + offsetSeconds))), pairCount: own.length };
  }).filter((anchor) => anchor.pairCount > 0);
  const correctionAt = (time: number): number => {
    if (!anchors.length) return 0;
    return anchors.reduce((best, anchor) => Math.abs(anchor.midiSeconds - time) < Math.abs(best.midiSeconds - time) ? anchor : best).correctionSeconds;
  };
  const map = (time: number): number => time * scale + offsetSeconds + correctionAt(time);
  for (let index = 1; index < input.midiOnsets.length; index += 1) {
    if (map(input.midiOnsets[index]) < map(input.midiOnsets[index - 1])) throw new Error("MIDI-to-audio mapping is not monotonic.");
  }
  const residuals = pairs.map((pair) => Math.abs(pair.stem - map(pair.midi)) * 1000);
  return { scale, offsetSeconds, anchors, pairCount: pairs.length, medianResidualMs: Math.round(median(residuals)), p90ResidualMs: Math.round(percentile(residuals, 0.9)), map };
}

const mergeIntervals = (intervals: VocalPhrase[], gapSeconds: number): VocalPhrase[] => {
  const merged: VocalPhrase[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start - previous.end <= gapSeconds) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
};

/** Convert Suno's explicitly labelled Vocal MIDI into deterministic sung timing evidence. */
export function parseSunoVocalMidi(
  bytes: Uint8Array,
  options: { audioDurationSeconds: number; phraseGapSeconds?: number; instrumentalGapSeconds?: number },
): SunoMidiTiming {
  const midi = new Midi(bytes);
  const notes = midi.tracks.flatMap((track) => track.notes).sort((left, right) => left.time - right.time);
  if (!notes.length) throw new Error("The selected Suno Vocal MIDI contains no notes.");

  const durationSeconds = Math.max(midi.duration, ...midi.header.tempos.map((tempo) => tempo.time));
  const drift = Math.abs(options.audioDurationSeconds - durationSeconds);
  if (drift > Math.max(2, options.audioDurationSeconds * 0.01)) {
    throw new Error(`Suno Vocal MIDI duration differs from the canonical audio by ${drift.toFixed(3)} seconds.`);
  }

  const noteIntervals = notes.map((note) => ({ start: note.time, end: note.time + Math.max(0.01, note.duration) }));
  const phrases = mergeIntervals(noteIntervals, options.phraseGapSeconds ?? 0.75);
  const vocalRegions = mergeIntervals(phrases, options.instrumentalGapSeconds ?? 2.5);
  const instrumentalGaps = vocalRegions.slice(0, -1).map((region, index) => ({ start: region.end, end: vocalRegions[index + 1].start }));
  const onsets = notes.map((note) => note.time).filter((time, index, values) => index === 0 || time - values[index - 1] >= 0.025);

  return { durationSeconds, phrases, onsets, vocalRegions, instrumentalGaps, noteCount: notes.length };
}
