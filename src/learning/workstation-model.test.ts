import { describe, expect, it } from "vitest";
import type { NoteEvent, Timeline } from "./contracts";
import type { HarmonicEvent } from "./harmony";
import { buildStudyArrangement, createContinuousLearningTimeline, describeStudyKey, parseSourceKey, samePrimaryLearningSequence, transformLearningTimeline, type WorkstationTransform } from "./workstation-model";

const notes: NoteEvent[] = [
  { id: "learning-a", partId: "v", measureIndex: 0, beat: 1, startSeconds: 1, durationSeconds: 0.3, midi: 59, velocity: .8, hand: "unknown" },
  { id: "learning-b", partId: "v", measureIndex: 0, beat: 2, startSeconds: 3, durationSeconds: 0.4, midi: 62, velocity: .8, hand: "unknown" },
  { id: "learning-c", partId: "v", measureIndex: 0, beat: 3, startSeconds: 4, durationSeconds: 0.5, midi: 66, velocity: .8, hand: "unknown" },
];
const timeline: Timeline = { version: "v1", durationSeconds: 6, notes, tempos: [{ atSeconds: 0, bpm: 120, measureIndex: 0 }], timeSignatures: [], measures: [{ index: 0, number: "1", startSeconds: 0, durationSeconds: 6, beats: 4, beatType: 4, pickup: false }] };
const harmony: HarmonicEvent = { id: "b-minor", startSeconds: 0, durationSeconds: 6, label: "Bm", pitches: [47, 59, 62, 66], pitchClasses: [11, 2, 6], bassPitchClass: 11, inferred: false, confidence: 1, guitar: [] };
const base: WorkstationTransform = { timing: "continuous", mode: "original", targetTonic: null, transpose: 0, sourceKey: parseSourceKey("B minor") };

describe("Learning Workstation transform pipeline", () => {
  it("starts the first Continuous note at zero and leaves at most 20ms internal silence", () => {
    const result = createContinuousLearningTimeline(timeline);
    expect(result.timeline.notes[0].startSeconds).toBe(0);
    expect(result.maxInternalSilenceSeconds).toBeLessThanOrEqual(.02);
    expect(result.timeline.notes[0].durationSeconds).toBeCloseTo(1.98);
  });

  it("keeps Original timing available and never mutates the canonical source", () => {
    const before = JSON.stringify(timeline);
    const result = transformLearningTimeline(timeline, { ...base, timing: "original" });
    expect(result.timeline.notes.map((note) => note.startSeconds)).toEqual([1, 3, 4]);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it("applies semitone, octave and reset offsets deterministically", () => {
    expect(transformLearningTimeline(timeline, { ...base, transpose: 1 }).timeline.notes[0].midi).toBe(60);
    expect(transformLearningTimeline(timeline, { ...base, transpose: 12 }).timeline.notes[0].midi).toBe(71);
    expect(transformLearningTimeline(timeline, base).timeline.notes[0].midi).toBe(59);
  });

  it("transposes to a target key and describes the study key", () => {
    const state = { ...base, targetTonic: 2 };
    expect(describeStudyKey(state)).toEqual({ source: "B minor", study: "D minor", semitones: 3 });
    expect(transformLearningTimeline(timeline, state).timeline.notes[0].midi).toBe(62);
  });

  it("maps Major/Minor study modes deterministically without mutating rhythm", () => {
    const major = transformLearningTimeline(timeline, { ...base, mode: "major" });
    expect(major.timeline.notes.map((note) => note.startSeconds)).toEqual([0, 2, 3]);
    expect(major.timeline.notes.map((note) => note.midi)).toEqual([59, 63, 66]);
    expect(transformLearningTimeline(timeline, { ...base, mode: "major" }).timeline.notes).toEqual(major.timeline.notes);
  });

  it("keeps one stable learningId sequence across Melody, Piano and Guitar arrangements", () => {
    const transformed = transformLearningTimeline(timeline, base).timeline;
    const melody = buildStudyArrangement(transformed, [harmony], "melody", 1);
    const piano = buildStudyArrangement(transformed, [harmony], "piano", 4);
    const guitar = buildStudyArrangement(transformed, [harmony], "guitar", 3);
    expect(samePrimaryLearningSequence(melody, piano)).toBe(true);
    expect(samePrimaryLearningSequence(melody, guitar)).toBe(true);
    expect(new Set(piano.notes.map((note) => note.partId))).toEqual(new Set(["study-piano-voice-1", "study-piano-voice-2", "study-piano-voice-3", "study-piano-voice-4"]));
  });
});
