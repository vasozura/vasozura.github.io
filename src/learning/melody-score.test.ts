import { describe, expect, it } from "vitest";
import type { NoteEvent } from "./contracts";
import { buildMelodyScore } from "./melody-score";

const notes = [60, 64, 67, 69].map((midi, index): NoteEvent => ({ id: `n${index}`, partId: "melody", measureIndex: 0, beat: index + 1, startSeconds: index, durationSeconds: 0.5, midi, velocity: 0.8, hand: "unknown" }));

describe("independent Learning Melody score", () => {
  it("preserves one exact note sequence and builds continuous guitar positions", () => {
    const score = buildMelodyScore(notes);
    expect(score.map((entry) => entry.id)).toEqual(notes.map((note) => note.id));
    expect(score.map((entry) => entry.midi)).toEqual([60, 64, 67, 69]);
    expect(score.every((entry) => entry.guitar != null)).toBe(true);
  });
});
