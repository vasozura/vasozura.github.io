import type { AttemptEvent, AttemptResult, Exercise, NoteEvent } from "./contracts";

export function evaluateAttempt(
  exercise: Exercise,
  expected: NoteEvent[],
  actual: AttemptEvent[],
  reliable = true,
): AttemptResult {
  const notes = expected.filter((note) =>
    note.measureIndex >= exercise.fromMeasure
    && note.measureIndex <= exercise.toMeasure
    && (!exercise.partIds.length || exercise.partIds.includes(note.partId)));
  if (!reliable) {
    return { exerciseId: exercise.id, pitchScore: 0, timingScore: 0, durationScore: 0, completion: 0, streak: 0, pausedForTiming: true, wrong: [], missed: [], feedback: [] };
  }

  const used = new Set<number>();
  let pitch = 0;
  let timing = 0;
  let duration = 0;
  let streak = 0;
  let best = 0;
  const missed: string[] = [];
  const feedback: AttemptResult["feedback"] = [];
  for (const note of notes) {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    actual.forEach((event, index) => {
      if (used.has(index) || event.midi !== note.midi) return;
      const delta = Math.abs(event.startedAtMs - note.startSeconds * 1_000);
      if (delta < bestDelta) { bestDelta = delta; bestIndex = index; }
    });
    if (bestIndex < 0 || bestDelta > exercise.timingToleranceMs) {
      missed.push(note.id);
      feedback.push({ status: "missed", sourceNoteId: note.id, expectedMidi: note.midi, playedMidi: null, onsetDeltaMs: null, measureNumber: note.measureIndex + 1, beat: note.beat, partId: note.partId });
      streak = 0;
      continue;
    }
    const played = actual[bestIndex];
    used.add(bestIndex);
    pitch += 1;
    timing += Math.max(0, 1 - bestDelta / exercise.timingToleranceMs);
    duration += Math.max(0, 1 - Math.abs(played.durationMs - note.durationSeconds * 1_000) / Math.max(100, note.durationSeconds * 1_000));
    best = Math.max(best, ++streak);
    feedback.push({ status: "correct", sourceNoteId: note.id, expectedMidi: note.midi, playedMidi: played.midi, onsetDeltaMs: Math.round(played.startedAtMs - note.startSeconds * 1_000), measureNumber: note.measureIndex + 1, beat: note.beat, partId: note.partId });
  }
  actual.forEach((played, index) => {
    if (!used.has(index)) feedback.push({ status: "extra", sourceNoteId: null, expectedMidi: null, playedMidi: played.midi, onsetDeltaMs: null, measureNumber: null, beat: null, partId: null });
  });
  const total = Math.max(1, notes.length);
  return {
    exerciseId: exercise.id,
    pitchScore: pitch / total * 100,
    timingScore: timing / total * 100,
    durationScore: duration / total * 100,
    completion: pitch / total * 100,
    streak: best,
    pausedForTiming: false,
    wrong: actual.filter((_, index) => !used.has(index)).map((event) => event.midi),
    missed,
    feedback,
  };
}

export class MidiAttemptRecorder {
  private events: AttemptEvent[] = [];
  private starts = new Map<number, number>();

  noteOn(midi: number, velocity: number, now = performance.now()): void {
    this.starts.set(midi, now);
    this.events.push({ midi, velocity, startedAtMs: now, durationMs: 0 });
  }

  noteOff(midi: number, now = performance.now()): void {
    const start = this.starts.get(midi);
    if (start === undefined) return;
    const event = [...this.events].reverse().find((item) => item.midi === midi && item.durationMs === 0);
    if (event) event.durationMs = now - start;
    this.starts.delete(midi);
  }

  result(): AttemptEvent[] { return structuredClone(this.events); }
  clear(): void { this.events = []; this.starts.clear(); }
}
