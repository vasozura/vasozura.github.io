import type { Timeline } from "./contracts";
import type { GuitarChordPosition, HarmonicEvent } from "./harmony";

export const chordPatternNames = ["block", "bass-12321", "bass-123-bass-123", "bass-1323", "bass-321", "up", "down", "up-down", "alberti"] as const;
export type ChordPatternName = typeof chordPatternNames[number];
export const patternRates = ["1/4", "1/8", "1/16"] as const;
export type PatternRate = typeof patternRates[number];
export type PatternInstrument = "piano" | "guitar" | "accordion";

export interface PlayableChordTone {
  midi: number;
  role: string;
  guitar?: GuitarChordPosition;
}

export interface ChordPatternFrame {
  tones: PlayableChordTone[];
  stepLabel: string;
  slot: number;
  boundaryKey: string;
  eventKey: string;
  canonicalStepSeconds: number;
  wallStepSeconds: number;
}

function upperPositions(toneCount: number): number[] {
  return Array.from({ length: Math.min(3, Math.max(0, toneCount - 1)) }, (_, index) => index + 1);
}

/** Indices are positions in the current playable voicing, never scale degrees. */
export function chordPatternSteps(pattern: ChordPatternName, toneCount: number): number[][] {
  if (toneCount <= 0) return [];
  const all = Array.from({ length: toneCount }, (_, index) => index);
  const upper = upperPositions(toneCount);
  const [one = 0, two = one, three = two] = upper;
  switch (pattern) {
    case "block": return [all];
    case "bass-12321": return [[0], [one], [two], [three], [two], [one]];
    case "bass-123-bass-123": return [[0], [one], [two], [three], [0], [one], [two], [three]];
    case "bass-1323": return [[0], [one], [three], [two], [three]];
    case "bass-321": return [[0], [three], [two], [one]];
    case "up": return all.map((index) => [index]);
    case "down": return [...all].reverse().map((index) => [index]);
    case "up-down": return [...all, ...all.slice(1, -1).reverse()].map((index) => [index]);
    case "alberti": return [[0], [three], [two], [three]];
  }
}

export function playableChordVoicing(harmony: HarmonicEvent, instrument: PatternInstrument): PlayableChordTone[] {
  if (instrument === "guitar" && harmony.guitar.length) {
    return [...harmony.guitar]
      .sort((a, b) => a.midi - b.midi || b.string - a.string)
      .map((guitar, index) => ({ midi: guitar.midi, role: index === 0 ? "Bass" : String(index), guitar }));
  }
  return harmony.pitches.map((midi, index) => ({ midi, role: index === 0 ? "Bass" : String(index) }));
}

export function tempoAt(timeline: Timeline, position: number): number {
  let bpm = timeline.tempos[0]?.bpm ?? 120;
  for (const event of timeline.tempos) {
    if (event.atSeconds > position) break;
    bpm = event.bpm;
  }
  return bpm;
}

export function canonicalPatternStepSeconds(bpm: number, rate: PatternRate): number {
  const quarter = 60 / Math.max(1, bpm);
  return rate === "1/4" ? quarter : rate === "1/8" ? quarter / 2 : quarter / 4;
}

export function patternStepSeconds(bpm: number, rate: PatternRate, tempoPercent: number): number {
  return canonicalPatternStepSeconds(bpm, rate) / Math.max(0.5, Math.min(1.5, tempoPercent / 100));
}

function subdivisionProgress(timeline: Timeline, start: number, end: number, rate: PatternRate): number {
  const subdivisionsPerQuarter = rate === "1/4" ? 1 : rate === "1/8" ? 2 : 4;
  let cursor = start;
  let bpm = tempoAt(timeline, start);
  let progress = 0;
  for (const event of timeline.tempos) {
    if (event.atSeconds <= start) continue;
    if (event.atSeconds >= end) break;
    progress += (event.atSeconds - cursor) * bpm / 60 * subdivisionsPerQuarter;
    cursor = event.atSeconds;
    bpm = event.bpm;
  }
  return progress + Math.max(0, end - cursor) * bpm / 60 * subdivisionsPerQuarter;
}

export function resolveChordPatternFrame(
  timeline: Timeline,
  harmony: HarmonicEvent,
  position: number,
  pattern: ChordPatternName,
  rate: PatternRate,
  instrument: PatternInstrument,
  tempoPercent: number,
): ChordPatternFrame {
  const voicing = playableChordVoicing(harmony, instrument);
  const steps = chordPatternSteps(pattern, voicing.length);
  const canonicalStepSeconds = canonicalPatternStepSeconds(tempoAt(timeline, position), rate);
  const absoluteSlot = Math.max(0, Math.floor(subdivisionProgress(timeline, harmony.startSeconds, position, rate) + 1e-7));
  const slot = pattern === "block" ? 0 : absoluteSlot % Math.max(1, steps.length);
  const indices = steps[slot] ?? [];
  const tones = indices.flatMap((index) => voicing[index] ? [voicing[index]] : []);
  const stepLabel = pattern === "block" ? "Block" : tones[0]?.role ?? "—";
  return {
    tones,
    stepLabel,
    slot,
    boundaryKey: `${harmony.id}:${absoluteSlot}`,
    eventKey: pattern === "block" ? `${harmony.id}:block` : `${harmony.id}:${pattern}:${absoluteSlot}`,
    canonicalStepSeconds,
    wallStepSeconds: patternStepSeconds(tempoAt(timeline, position), rate, tempoPercent),
  };
}
