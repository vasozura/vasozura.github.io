import type { ExtractedVocalNote, LearningVocalNote, VocalMidiDiagnostics } from "./contracts";

export interface CleanVocalOptions {
  minimumDurationSeconds?: number;
  minimumConfidence?: number;
  mergeGapSeconds?: number;
}

export interface CleanVocalResult {
  notes: ExtractedVocalNote[];
  diagnostics: VocalMidiDiagnostics;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const median = (values: number[]): number => {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

function diagnostics(notes: ExtractedVocalNote[], rejected: number, octaveCorrections: number): VocalMidiDiagnostics {
  let overlaps = 0;
  let longestSilence = 0;
  for (let index = 1; index < notes.length; index += 1) {
    const previousEnd = notes[index - 1].startSeconds + notes[index - 1].durationSeconds;
    if (notes[index].startSeconds < previousEnd - 0.005) overlaps += 1;
    longestSilence = Math.max(longestSilence, notes[index].startSeconds - previousEnd);
  }
  const averageConfidence = notes.reduce((sum, note) => sum + note.pitchConfidence, 0) / Math.max(1, notes.length);
  const monophonyRatio = notes.length ? 1 - overlaps / notes.length : 1;
  const status = notes.length >= 8 && averageConfidence >= 0.55 && monophonyRatio >= 0.96 ? "verified" : "review";
  return {
    noteCount: notes.length,
    pitchMin: notes.length ? Math.min(...notes.map((note) => note.midi)) : null,
    pitchMax: notes.length ? Math.max(...notes.map((note) => note.midi)) : null,
    medianNoteDurationMs: Math.round(median(notes.map((note) => note.durationSeconds)) * 1000),
    shortNoteRejectionCount: rejected,
    octaveCorrectionCount: octaveCorrections,
    longestSilenceMs: Math.round(Math.max(0, longestSilence) * 1000),
    pitchConfidence: Number(averageConfidence.toFixed(3)),
    monophonyRatio: Number(monophonyRatio.toFixed(4)),
    status,
  };
}

export function cleanVocalNotes(input: readonly ExtractedVocalNote[], options: CleanVocalOptions = {}): CleanVocalResult {
  const minimumDuration = options.minimumDurationSeconds ?? 0.065;
  const minimumConfidence = options.minimumConfidence ?? 0.25;
  const mergeGap = options.mergeGapSeconds ?? 0.08;
  let rejected = 0;
  let octaveCorrections = 0;
  const normalized: ExtractedVocalNote[] = [];
  const ordered = [...input].sort((a, b) => a.startSeconds - b.startSeconds || b.confidence - a.confidence || a.id.localeCompare(b.id));
  for (const source of ordered) {
    if (!Number.isFinite(source.startSeconds) || !Number.isFinite(source.durationSeconds) || source.durationSeconds < minimumDuration || source.confidence < minimumConfidence) {
      rejected += 1;
      continue;
    }
    const note = { ...source, midi: Math.round(clamp(source.midi, 0, 127)), velocity: clamp(source.velocity, 0.05, 1), pitchConfidence: clamp(source.pitchConfidence, 0, 1) };
    const previous = normalized.at(-1);
    if (previous && note.pitchConfidence < 0.58 && Math.abs(note.midi - previous.midi) >= 11) {
      const candidates = [note.midi - 12, note.midi + 12].filter((midi) => midi >= 0 && midi <= 127);
      const corrected = candidates.sort((a, b) => Math.abs(a - previous.midi) - Math.abs(b - previous.midi))[0];
      if (corrected !== undefined && Math.abs(corrected - previous.midi) + 6 <= Math.abs(note.midi - previous.midi)) {
        note.midi = corrected;
        octaveCorrections += 1;
      }
    }
    if (previous && note.startSeconds < previous.startSeconds + previous.durationSeconds) {
      if (note.midi === previous.midi && Math.abs(note.startSeconds - previous.startSeconds) < 0.04) {
        previous.durationSeconds = Math.max(previous.durationSeconds, note.startSeconds + note.durationSeconds - previous.startSeconds);
        previous.confidence = Math.max(previous.confidence, note.confidence);
        continue;
      }
      previous.durationSeconds = Math.max(0.03, note.startSeconds - previous.startSeconds - 0.005);
    }
    const latest = normalized.at(-1);
    if (latest && latest.midi === note.midi && note.startSeconds - (latest.startSeconds + latest.durationSeconds) <= mergeGap) {
      latest.durationSeconds = note.startSeconds + note.durationSeconds - latest.startSeconds;
      latest.confidence = Math.max(latest.confidence, note.confidence);
      latest.pitchConfidence = Math.max(latest.pitchConfidence, note.pitchConfidence);
      continue;
    }
    normalized.push(note);
  }
  return { notes: normalized, diagnostics: diagnostics(normalized, rejected, octaveCorrections) };
}

export function createLearningNotes(notes: readonly ExtractedVocalNote[], provenance = "MP3 Vocal Extraction"): LearningVocalNote[] {
  return notes.map((note, index) => ({
    ...note,
    learningId: `vocal-${index}-${note.id}`,
    originalStartSeconds: note.startSeconds,
    originalDurationSeconds: note.durationSeconds,
    lyricLineId: null,
    wordId: null,
    syllableId: null,
    provenance,
  }));
}

export function createContinuousLearningNotes(input: readonly LearningVocalNote[], maximumInternalSilenceSeconds = 0.03): LearningVocalNote[] {
  const notes = input.map((note) => ({ ...note })).sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi);
  if (!notes.length) return notes;
  const offset = notes[0].startSeconds;
  for (const note of notes) note.startSeconds = Math.max(0, note.startSeconds - offset);
  for (let index = 0; index < notes.length - 1; index += 1) {
    const note = notes[index];
    const next = notes[index + 1];
    const currentEnd = note.startSeconds + note.durationSeconds;
    const gap = next.startSeconds - currentEnd;
    if (gap > maximumInternalSilenceSeconds) note.durationSeconds += gap - maximumInternalSilenceSeconds;
    if (note.startSeconds + note.durationSeconds > next.startSeconds) note.durationSeconds = Math.max(0.01, next.startSeconds - note.startSeconds - 0.005);
  }
  return notes;
}

export function maximumInternalSilenceMs(notes: readonly Pick<LearningVocalNote, "startSeconds" | "durationSeconds">[]): number {
  const ordered = [...notes].sort((a, b) => a.startSeconds - b.startSeconds);
  return Math.round(Math.max(0, ...ordered.slice(1).map((note, index) => note.startSeconds - (ordered[index].startSeconds + ordered[index].durationSeconds))) * 1000);
}

function interpolate(value: number, a: number, b: number, c: number, d: number): number {
  if (Math.abs(b - a) < 1e-9) return c;
  return c + (value - a) / (b - a) * (d - c);
}

export function originalTimeFromLearningTime(time: number, continuous: readonly LearningVocalNote[]): number {
  if (!continuous.length) return time;
  const index = Math.max(0, continuous.findIndex((note) => time < note.startSeconds) - 1);
  const current = continuous[index];
  const next = continuous[index + 1];
  if (!next) return current.originalStartSeconds + Math.max(0, time - current.startSeconds);
  return interpolate(time, current.startSeconds, next.startSeconds, current.originalStartSeconds, next.originalStartSeconds);
}

export function learningTimeFromOriginalTime(time: number, continuous: readonly LearningVocalNote[]): number {
  if (!continuous.length) return time;
  const index = Math.max(0, continuous.findIndex((note) => time < note.originalStartSeconds) - 1);
  const current = continuous[index];
  const next = continuous[index + 1];
  if (!next) return current.startSeconds + Math.max(0, time - current.originalStartSeconds);
  return interpolate(time, current.originalStartSeconds, next.originalStartSeconds, current.startSeconds, next.startSeconds);
}
