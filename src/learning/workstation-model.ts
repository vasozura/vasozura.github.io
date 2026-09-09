import type { NoteEvent, Timeline } from "./contracts";
import { activeHarmonyAt, type HarmonicEvent } from "./harmony";

export type LearningPart = "melody" | "piano" | "guitar";
export type LearningTiming = "continuous" | "original";
export type StudyMode = "original" | "major" | "minor";
export type StudyVoiceCount = 1 | 2 | 3 | 4;

export interface SourceKey { tonic: number; mode: "major" | "minor"; label: string; }
export interface WorkstationTransform {
  timing: LearningTiming;
  mode: StudyMode;
  targetTonic: number | null;
  transpose: number;
  sourceKey: SourceKey;
}

export interface ContinuousTimelineResult {
  timeline: Timeline;
  originalOffsetSeconds: number;
  maxInternalSilenceSeconds: number;
  originalToStudy(seconds: number): number;
  studyToOriginal(seconds: number): number;
}

const major = [0, 2, 4, 5, 7, 9, 11];
const minor = [0, 2, 3, 5, 7, 8, 10];
const keyNames = ["C", "C♯/D♭", "D", "D♯/E♭", "E", "F", "F♯/G♭", "G", "G♯/A♭", "A", "A♯/B♭", "B"];
const pitchClasses: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const modulo = (value: number, size = 12): number => ((value % size) + size) % size;
const nearestSigned = (from: number, to: number): number => {
  const up = modulo(to - from);
  return up > 6 ? up - 12 : up;
};

export function parseSourceKey(value: string | null | undefined): SourceKey {
  const normalized = (value ?? "C major").trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = /^([A-G](?:#|b)?)(?:\s*|\s+)(m|min|minor|major|maj)?/i.exec(normalized);
  const root = match ? match[1][0].toUpperCase() + match[1].slice(1) : "C";
  const quality = (match?.[2] ?? (/m(?:in(?:or)?)?$/i.test(normalized) ? "minor" : "major")).toLowerCase();
  const mode = quality === "m" || quality.startsWith("min") ? "minor" : "major";
  const tonic = pitchClasses[root] ?? 0;
  return { tonic, mode, label: `${keyNames[tonic]} ${mode}` };
}

export function describeStudyKey(state: WorkstationTransform): { source: string; study: string; semitones: number } {
  const tonic = state.targetTonic ?? state.sourceKey.tonic;
  const mode = state.mode === "original" ? state.sourceKey.mode : state.mode;
  const keyOffset = state.targetTonic == null ? 0 : nearestSigned(state.sourceKey.tonic, state.targetTonic);
  return { source: state.sourceKey.label, study: `${keyNames[modulo(tonic + state.transpose)]} ${mode}`, semitones: keyOffset + state.transpose };
}

export function createContinuousLearningTimeline(source: Timeline, maxArticulationGapSeconds = 0.02): ContinuousTimelineResult {
  const ordered = [...source.notes].sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id));
  const offset = ordered[0]?.startSeconds ?? 0;
  const notes = ordered.map((note, index) => {
    const startSeconds = Math.max(0, note.startSeconds - offset);
    const nextStart = ordered[index + 1] ? Math.max(0, ordered[index + 1].startSeconds - offset) : null;
    const bridged = nextStart == null ? note.durationSeconds : Math.max(note.durationSeconds, nextStart - startSeconds - maxArticulationGapSeconds);
    return { ...note, startSeconds, durationSeconds: Math.max(0.03, bridged), cursorStep: index };
  });
  const measuredSilence = Math.max(0, ...notes.slice(0, -1).map((note, index) => Math.max(0, notes[index + 1].startSeconds - (note.startSeconds + note.durationSeconds))));
  const maxInternalSilenceSeconds = Math.min(maxArticulationGapSeconds, measuredSilence);
  const durationSeconds = notes.length ? notes.at(-1)!.startSeconds + notes.at(-1)!.durationSeconds : 0;
  const measures = source.measures.map((measure) => ({ ...measure, startSeconds: Math.max(0, measure.startSeconds - offset) }));
  return {
    timeline: { ...source, durationSeconds, notes, measures },
    originalOffsetSeconds: offset,
    maxInternalSilenceSeconds,
    originalToStudy: (seconds) => Math.max(0, seconds - offset),
    studyToOriginal: (seconds) => Math.min(source.durationSeconds, Math.max(0, seconds) + offset),
  };
}

function mapModePitch(midi: number, source: SourceKey, targetMode: "major" | "minor", targetTonic: number): number {
  const sourceScale = source.mode === "major" ? major : minor;
  const targetScale = targetMode === "major" ? major : minor;
  const relative = modulo(midi - source.tonic);
  let degree = 0;
  let accidental = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  sourceScale.forEach((pitch, index) => {
    const distance = Math.abs(nearestSigned(pitch, relative));
    if (distance < bestDistance) { bestDistance = distance; degree = index; accidental = nearestSigned(pitch, relative); }
  });
  const sourceBase = midi - relative;
  return sourceBase + nearestSigned(source.tonic, targetTonic) + targetScale[degree] + accidental;
}

export function transformLearningTimeline(source: Timeline, state: WorkstationTransform): ContinuousTimelineResult {
  const timed = state.timing === "continuous"
    ? createContinuousLearningTimeline(source)
    : { timeline: { ...source, notes: source.notes.map((note) => ({ ...note })) }, originalOffsetSeconds: 0, maxInternalSilenceSeconds: Math.max(0, ...source.notes.slice(0, -1).map((note, index) => Math.max(0, source.notes[index + 1].startSeconds - note.startSeconds - note.durationSeconds))), originalToStudy: (seconds: number) => seconds, studyToOriginal: (seconds: number) => seconds };
  const targetTonic = state.targetTonic ?? state.sourceKey.tonic;
  const targetMode = state.mode === "original" ? state.sourceKey.mode : state.mode;
  const keyShift = state.targetTonic == null ? 0 : nearestSigned(state.sourceKey.tonic, targetTonic);
  const notes = timed.timeline.notes.map((note) => ({
    ...note,
    midi: (state.mode === "original" ? note.midi + keyShift : mapModePitch(note.midi, state.sourceKey, targetMode, targetTonic)) + state.transpose,
  }));
  return { ...timed, timeline: { ...timed.timeline, notes } };
}

function nearestChordPitch(target: number, harmony: HarmonicEvent, previous: number | null, min: number, max: number): number {
  const candidates: number[] = [];
  for (let midi = min; midi <= max; midi += 1) if (harmony.pitchClasses.includes(modulo(midi))) candidates.push(midi);
  const reference = previous ?? target;
  return candidates.sort((a, b) => Math.abs(a - target) + Math.abs(a - reference) * 0.65 - (Math.abs(b - target) + Math.abs(b - reference) * 0.65) || a - b)[0] ?? target;
}

export function buildStudyArrangement(timeline: Timeline, harmonies: HarmonicEvent[], part: LearningPart, voices: StudyVoiceCount): Timeline {
  const primary = timeline.notes.map((note) => ({ ...note, partId: `study-${part}-voice-1` }));
  if (voices === 1) return { ...timeline, notes: primary };
  const support: NoteEvent[] = [];
  const previous = new Map<number, number>();
  for (const note of primary) {
    const harmony = activeHarmonyAt(harmonies, note.startSeconds);
    if (!harmony) continue;
    for (let voice = 2; voice <= voices; voice += 1) {
      const target = note.midi - (part === "guitar" ? 5 + (voice - 2) * 4 : 7 + (voice - 2) * 5);
      const midi = nearestChordPitch(target, harmony, previous.get(voice) ?? null, part === "guitar" ? 40 : 36, part === "guitar" ? 84 : 96);
      previous.set(voice, midi);
      support.push({ ...note, id: `${note.id}-study-v${voice}`, partId: `study-${part}-voice-${voice}`, midi, velocity: Math.max(0.2, note.velocity * (0.62 - (voice - 2) * 0.08)), hand: voice === 2 ? "left" : "right" });
    }
  }
  return { ...timeline, notes: [...primary, ...support].sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id)) };
}

export function samePrimaryLearningSequence(a: Timeline, b: Timeline): boolean {
  const primary = (timeline: Timeline) => timeline.notes.filter((note) => !/-study-v[234]$/.test(note.id));
  const left = primary(a); const right = primary(b);
  return left.length === right.length && left.every((note, index) => note.id === right[index].id && note.midi === right[index].midi && note.startSeconds === right[index].startSeconds);
}
