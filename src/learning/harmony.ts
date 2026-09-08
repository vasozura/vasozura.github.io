import type { NoteEvent, Timeline } from "./contracts";

export interface ExplicitHarmony { measureIndex: number; relativePosition: number; label: string; }
export interface GuitarChordPosition { string: number; fret: number; midi: number; }
export interface HarmonicEvent {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  label: string;
  pitches: number[];
  pitchClasses: number[];
  bassPitchClass: number;
  inferred: boolean;
  confidence: number;
  guitar: GuitarChordPosition[];
}

const roots: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const patterns = [
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7♭5", intervals: [0, 3, 6, 10] },
  { suffix: "dim7", intervals: [0, 3, 6, 9] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "aug", intervals: [0, 4, 8] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  { suffix: "sus2", intervals: [0, 2, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "", intervals: [0, 4, 7] },
] as const;

const chordShapes: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0], Am: [-1, 0, 2, 2, 1, 0], G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1],
  D: [-1, -1, 0, 2, 3, 2], Dm: [-1, -1, 0, 2, 3, 1], Dm7: [-1, -1, 0, 2, 1, 1], E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0], A: [-1, 0, 2, 2, 2, 0], A7: [-1, 0, 2, 0, 2, 0], F: [1, 3, 3, 2, 1, 1],
};
const openStrings = [40, 45, 50, 55, 59, 64];

function normalizeLabel(label: string): string { return label.trim().replace(/♭/g, "b").replace(/♯/g, "#").replace(/min/i, "m"); }

export function parseChordLabel(raw: string): { label: string; root: number; intervals: number[]; bass: number } | null {
  const label = normalizeLabel(raw);
  const match = /^([A-G](?:#|b)?)(maj7|m7b5|dim7|min7|m7|7|dim|aug|sus4|sus2|min|m)?(?:\/([A-G](?:#|b)?))?$/i.exec(label);
  if (!match) return null;
  const rootName = match[1][0].toUpperCase() + match[1].slice(1);
  const root = roots[rootName];
  if (root == null) return null;
  const quality = (match[2] ?? "").toLowerCase().replace("min", "m").replace("m7b5", "m7♭5");
  const pattern = patterns.find((item) => item.suffix.toLowerCase() === quality) ?? patterns.at(-1)!;
  const bassName = match[3] ? match[3][0].toUpperCase() + match[3].slice(1) : rootName;
  return { label: `${rootName}${pattern.suffix}${match[3] ? `/${bassName}` : ""}`, root, intervals: [...pattern.intervals], bass: roots[bassName] ?? root };
}

function voicing(root: number, intervals: readonly number[], bass: number): number[] {
  const pitches = intervals.map((interval) => 48 + root + interval).map((midi) => midi > 71 ? midi - 12 : midi).sort((a, b) => a - b);
  const bassMidi = 36 + bass + (36 + bass < 40 ? 12 : 0);
  return [...new Set([bassMidi, ...pitches])].slice(0, 4);
}

function guitarShape(label: string, pitchClasses: number[]): GuitarChordPosition[] {
  const shape = chordShapes[label.replace(/\/.*$/, "")];
  if (shape) return shape.flatMap((fret, index) => fret < 0 ? [] : [{ string: 6 - index, fret, midi: openStrings[index] + fret }]);
  const used = new Set<number>();
  const result: GuitarChordPosition[] = [];
  for (let index = 0; index < openStrings.length; index += 1) {
    for (let fret = 0; fret <= 12; fret += 1) {
      const midi = openStrings[index] + fret;
      if (pitchClasses.includes(midi % 12) && !used.has(midi % 12)) { result.push({ string: 6 - index, fret, midi }); used.add(midi % 12); break; }
    }
    if (result.length >= 4) break;
  }
  return result;
}

function makeEvent(label: string, startSeconds: number, durationSeconds: number, inferred: boolean, confidence: number): HarmonicEvent | null {
  const parsed = parseChordLabel(label);
  if (!parsed) return null;
  const pitchClasses = parsed.intervals.map((interval) => (parsed.root + interval) % 12);
  return { id: `chord-${startSeconds.toFixed(4)}-${parsed.label}`, startSeconds, durationSeconds, label: parsed.label, pitches: voicing(parsed.root, parsed.intervals, parsed.bass), pitchClasses, bassPitchClass: parsed.bass, inferred, confidence, guitar: guitarShape(parsed.label, pitchClasses) };
}

function inferWindow(notes: NoteEvent[]): { label: string; confidence: number } | null {
  if (!notes.length) return null;
  const weights = new Map<number, number>();
  for (const note of notes) {
    const weight = Math.max(0.05, Math.min(note.durationSeconds, 1.5)) * (note.durationSeconds < 0.12 ? 0.2 : 1);
    weights.set(note.midi % 12, (weights.get(note.midi % 12) ?? 0) + weight);
  }
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  let best: { label: string; confidence: number; size: number } | null = null;
  for (let root = 0; root < 12; root += 1) for (const pattern of patterns) {
    const pcs = pattern.intervals.map((interval) => (root + interval) % 12);
    const covered = pcs.reduce((sum, pc) => sum + (weights.get(pc) ?? 0), 0);
    const present = pcs.filter((pc) => (weights.get(pc) ?? 0) > 0).length;
    const confidence = total ? covered / total * (present / pcs.length) : 0;
    if (!best || confidence > best.confidence || confidence === best.confidence && pattern.intervals.length > best.size) best = { label: `${names[root]}${pattern.suffix}`, confidence, size: pattern.intervals.length };
  }
  return best && best.confidence >= 0.8 ? best : null;
}

export function buildHarmonicTimeline(timeline: Timeline, explicit: ExplicitHarmony[] = []): HarmonicEvent[] {
  const starts: Array<{ at: number; label: string; inferred: boolean; confidence: number }> = [];
  if (explicit.length) {
    for (const item of explicit) {
      const measure = timeline.measures[item.measureIndex];
      if (!measure || !parseChordLabel(item.label)) continue;
      starts.push({ at: measure.startSeconds + Math.max(0, Math.min(1, item.relativePosition)) * measure.durationSeconds, label: item.label, inferred: false, confidence: 1 });
    }
  } else {
    for (const measure of timeline.measures) {
      const beatLength = measure.durationSeconds / Math.max(1, measure.beats);
      for (let beat = 0; beat < measure.beats; beat += 1) {
        const at = measure.startSeconds + beat * beatLength;
        const end = at + beatLength;
        const notes = timeline.notes.filter((note) => note.startSeconds < end && note.startSeconds + note.durationSeconds > at);
        const inferred = inferWindow(notes);
        if (inferred && starts.at(-1)?.label !== inferred.label) starts.push({ at, label: inferred.label, inferred: true, confidence: inferred.confidence });
      }
    }
  }
  return starts.flatMap((item, index) => {
    const next = starts[index + 1]?.at ?? timeline.durationSeconds;
    const event = makeEvent(item.label, item.at, Math.max(0.04, next - item.at), item.inferred, item.confidence);
    return event ? [event] : [];
  });
}

export function activeHarmonyAt(events: HarmonicEvent[], seconds: number): HarmonicEvent | null {
  return events.find((event) => seconds >= event.startSeconds && seconds < event.startSeconds + event.durationSeconds) ?? null;
}
