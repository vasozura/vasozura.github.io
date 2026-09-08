import { describe, expect, it } from "vitest";
import type { Timeline } from "./contracts";
import type { HarmonicEvent } from "./harmony";
import { chordPatternSteps, patternStepSeconds, playableChordVoicing, resolveChordPatternFrame } from "./chord-patterns";

const timeline = { durationSeconds: 8, tempos: [{ atSeconds: 0, bpm: 120, measureIndex: 0 }] } as Timeline;
const harmony: HarmonicEvent = {
  id: "am", startSeconds: 0, durationSeconds: 8, label: "Am/E", pitches: [40, 57, 60, 64],
  pitchClasses: [9, 0, 4], bassPitchClass: 4, inferred: false, confidence: 1,
  guitar: [
    { string: 5, fret: 7, midi: 52 }, { string: 4, fret: 7, midi: 57 },
    { string: 3, fret: 5, midi: 60 }, { string: 2, fret: 5, midi: 64 },
  ],
};

const sequence = (pattern: Parameters<typeof chordPatternSteps>[0]) => chordPatternSteps(pattern, 4).map((step) => step[0]);

describe("chord playback patterns", () => {
  it("plays Block as simultaneous complete voicing", () => expect(chordPatternSteps("block", 4)).toEqual([[0, 1, 2, 3]]));
  it("orders Bass-12321", () => expect(sequence("bass-12321")).toEqual([0, 1, 2, 3, 2, 1]));
  it("orders Bass-123-Bass-123", () => expect(sequence("bass-123-bass-123")).toEqual([0, 1, 2, 3, 0, 1, 2, 3]));
  it("orders Bass-1323 and Bass-321", () => {
    expect(sequence("bass-1323")).toEqual([0, 1, 3, 2, 3]);
    expect(sequence("bass-321")).toEqual([0, 3, 2, 1]);
  });
  it("orders Up and Down", () => {
    expect(sequence("up")).toEqual([0, 1, 2, 3]);
    expect(sequence("down")).toEqual([3, 2, 1, 0]);
  });
  it("orders Up / Down without repeating the endpoints", () => expect(sequence("up-down")).toEqual([0, 1, 2, 3, 2, 1]));
  it("uses low-high-middle-high for Alberti", () => expect(sequence("alberti")).toEqual([0, 3, 2, 3]));

  it("uses the real inversion bass and recognized chord tones only", () => {
    const frames = Array.from({ length: 6 }, (_, index) => resolveChordPatternFrame(timeline, harmony, index * 0.25, "bass-12321", "1/8", "piano", 100));
    expect(frames[0].tones[0].midi).toBe(40);
    expect(frames.flatMap((frame) => frame.tones).every((tone) => harmony.pitchClasses.includes(tone.midi % 12))).toBe(true);
  });

  it("follows the selected guitar shape from the lowest sounding string", () => {
    const voicing = playableChordVoicing(harmony, "guitar");
    expect(voicing.map((tone) => tone.guitar?.string)).toEqual([5, 4, 3, 2]);
    const frame = resolveChordPatternFrame(timeline, harmony, 0.25, "bass-12321", "1/8", "guitar", 100);
    expect(frame.tones[0].guitar).toEqual({ string: 4, fret: 7, midi: 57 });
  });

  it("changes tempo timing but never the selected pitch", () => {
    const slow = resolveChordPatternFrame(timeline, harmony, 0.25, "bass-12321", "1/8", "piano", 50);
    const fast = resolveChordPatternFrame(timeline, harmony, 0.25, "bass-12321", "1/8", "piano", 150);
    expect(slow.tones.map((tone) => tone.midi)).toEqual(fast.tones.map((tone) => tone.midi));
    expect(patternStepSeconds(120, "1/8", 50)).toBeCloseTo(0.5);
    expect(patternStepSeconds(120, "1/8", 150)).toBeCloseTo(1 / 6);
  });

  it("does not mutate the canonical timeline", () => {
    const before = JSON.stringify(timeline);
    resolveChordPatternFrame(timeline, harmony, 0.75, "alberti", "1/16", "piano", 125);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it("keeps subdivision phase continuous across canonical tempo changes", () => {
    const changing = { ...timeline, tempos: [{ atSeconds: 0, bpm: 120, measureIndex: 0 }, { atSeconds: 1, bpm: 60, measureIndex: 1 }] };
    const frame = resolveChordPatternFrame(changing, harmony, 1.5, "up", "1/8", "piano", 100);
    expect(frame.boundaryKey).toBe("am:5");
  });
});
