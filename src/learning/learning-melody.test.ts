import { describe, expect, it } from "vitest";
import type { NoteEvent, Timeline } from "./contracts";
import { compactLearningMelody, composeLearningMelody, replaceLearningSegmentSource, sameLearningSequence, selectGapFillLane } from "./learning-melody";
import type { VoiceLane } from "./voice-lanes";

const note = (id: string, startSeconds: number, midi: number, durationSeconds = 0.4): NoteEvent => ({ id, partId: "part", measureIndex: Math.floor(startSeconds / 4), beat: 1, startSeconds, durationSeconds, midi, velocity: 0.8, hand: "unknown" });
const lane = (id: string, partName: string, notes: NoteEvent[], inferred = false): VoiceLane => ({ id, label: partName, partId: id, partName, staff: 1, voice: "1", inferred, notes });
const timeline: Timeline = { version: "v1", durationSeconds: 12, notes: [], tempos: [{ atSeconds: 0, bpm: 120, measureIndex:0 }], timeSignatures: [{ atSeconds: 0, beats: 4, beatType: 4, measureIndex: 0 }], measures: [0, 1, 2].map((index) => ({ index, number: String(index + 1), startSeconds: index * 4, durationSeconds: 4, beats: 4, beatType: 4, pickup: false })) };

describe("complete Learning Melody", () => {
  it("uses the manual primary source and fills intro/interlude/outro only with source notes", () => {
    const vocal = lane("vocal", "Vocal", [note("v1", 2, 64), note("v2", 2.6, 65), note("v3", 8, 67)]);
    const lead = lane("lead", "Lead guitar", [note("l1", 0, 60), note("l2", 1, 62), note("l3", 4, 69), note("l4", 6, 71), note("l5", 10, 72)]);
    const melody = composeLearningMelody(timeline, [vocal, lead], { primaryLane: vocal, manualPrimary: true, gapFillLane: lead });
    expect(melody.notes.map((event) => event.sourceNoteId)).toEqual(["l1", "l2", "v1", "v2", "l3", "l4", "v3", "l5"]);
    expect(melody.segments.some((segment) => segment.provenance === "Manual reference")).toBe(true);
    expect(melody.notes.every((event) => ["vocal", "lead"].includes(event.sourceLaneId))).toBe(true);
  });

  it("allows manual segment source changes without mutating the canonical timeline", () => {
    const vocal = lane("vocal", "Vocal", [note("v1", 2, 64), note("v2", 8, 67)]);
    const lead = lane("lead", "Lead", [note("l1", 0, 60), note("l2", 5, 70)]);
    const alternate = lane("alt", "Reference", [note("a1", 0.5, 61), note("a2", 1.2, 63)]);
    const before = JSON.stringify(timeline);
    const melody = composeLearningMelody(timeline, [vocal, lead], { primaryLane: vocal, gapFillLane: lead });
    const intro = melody.segments[0];
    const changed = replaceLearningSegmentSource(melody, intro.id, alternate);
    expect(changed.notes.some((event) => event.sourceNoteId === "a1")).toBe(true);
    expect(changed.segments[0].provenance).toBe("Manual reference");
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it("compacts excessive gaps while preserving pitches, order, durations, and short rests", () => {
    const vocal = lane("vocal", "Vocal", [note("a", 0, 60), note("b", 0.7, 62), note("c", 4, 64)]);
    const melody = composeLearningMelody({ ...timeline, durationSeconds: 5 }, [vocal], { primaryLane: vocal, gapThresholdSeconds: 10 });
    const compact = compactLearningMelody(melody, 0.4, 0.6);
    expect(compact.timeline.notes.map((event) => event.midi)).toEqual([60, 62, 64]);
    expect(compact.timeline.notes.map((event) => event.durationSeconds)).toEqual([0.4, 0.4, 0.4]);
    expect(compact.timeline.notes[1].startSeconds - 0.4).toBeCloseTo(0.3);
    expect(compact.timeline.notes[2].startSeconds - (compact.timeline.notes[1].startSeconds + 0.4)).toBeCloseTo(0.4);
  });

  it("routes the identical Learning Melody event sequence to piano and guitar", () => {
    const melody = composeLearningMelody(timeline, [lane("v", "Vocal", [note("a", 0, 60), note("b", 1, 62)])]);
    const piano = { ...melody.timeline, notes: melody.timeline.notes.map((event) => ({ ...event })) };
    const guitar = { ...melody.timeline, notes: melody.timeline.notes.map((event) => ({ ...event })) };
    expect(sameLearningSequence(piano, guitar)).toBe(true);
  });

  it("normalizes overlapping source durations into one monophonic line", () => {
    const overlapping = lane("vocal", "Vocal", [note("a", 0, 60, 2), note("b", 1, 62, 2), note("c", 2, 64, 1)]);
    const melody = composeLearningMelody({ ...timeline, durationSeconds: 3 }, [overlapping], { primaryLane: overlapping });
    expect(melody.notes.map((event) => [event.startSeconds, event.durationSeconds])).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(melody.diagnostics.monophonyRatio).toBe(1);
  });

  it("chooses a principal melodic source for gaps and never defaults to bass ordering", () => {
    const bass = lane("bass", "Bass", [40, 41, 43, 45].map((midi, index) => note(`b${index}`, index, midi)));
    const guitar = lane("guitar", "Guitar lead", [64, 65, 67, 69].map((midi, index) => note(`g${index}`, index, midi)));
    expect(selectGapFillLane([bass, guitar])?.id).toBe("guitar");
  });
});
