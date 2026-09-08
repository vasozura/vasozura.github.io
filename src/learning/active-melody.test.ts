import { describe, expect, it } from "vitest";
import type { NoteEvent, Timeline } from "./contracts";
import { createActiveMelodyTimeline } from "./active-melody";
import { resolveCanonicalScoreLocation } from "../score/score-navigation";

const note = (id: string, startSeconds: number, midi: number): NoteEvent => ({ id, partId: "v", measureIndex: 0, beat: 1, startSeconds, durationSeconds: 0.4, midi, velocity: 0.8, hand: "unknown" });
const timeline: Timeline = { version: "v1", durationSeconds: 5, notes: [note("a", 0, 64), note("b", 0.7, 65), note("c", 3.5, 67)], tempos: [], timeSignatures: [], measures: [{ index: 0, number: "1", startSeconds: 0, durationSeconds: 5, beats: 4, beatType: 4, pickup: false }] };

describe("active melody timing", () => {
  it("compresses long rests, preserves short rests, pitches, order, and canonical input", () => {
    const before = JSON.stringify(timeline);
    const result = createActiveMelodyTimeline(timeline, timeline.notes);
    expect(result.timeline.notes.map((entry) => entry.startSeconds)).toEqual([0, 0.7, 1.3]);
    expect(result.timeline.notes.map((entry) => entry.midi)).toEqual([64, 65, 67]);
    expect(result.timeline.durationSeconds).toBeLessThan(timeline.durationSeconds);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it("maps active and original positions reversibly within tolerance", () => {
    const result = createActiveMelodyTimeline(timeline, timeline.notes);
    for (const seconds of [0, 0.2, 0.7, 1, 2, 3.5, 3.8, 5]) expect(result.activeToOriginal(result.originalToActive(seconds))).toBeCloseTo(seconds, 5);
  });

  it("preserves musical location when switching Original to Active", () => {
    const result = createActiveMelodyTimeline(timeline, timeline.notes);
    expect(result.activeToOriginal(result.originalToActive(3.5))).toBeCloseTo(3.5, 5);
  });

  it("maps score-click canonical seek into active vocal playback", () => {
    const result = createActiveMelodyTimeline(timeline, timeline.notes);
    const score = resolveCanonicalScoreLocation(timeline, { measureIndex: 0, relativePosition: 0.7 });
    expect(result.activeToOriginal(result.originalToActive(score.seconds))).toBeCloseTo(score.seconds, 5);
  });
});
