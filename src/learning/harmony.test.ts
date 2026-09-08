import { describe, expect, it } from "vitest";
import type { NoteEvent, Timeline } from "./contracts";
import { activeHarmonyAt, buildHarmonicTimeline, parseChordLabel } from "./harmony";

const n = (id: string, midi: number, start = 0, duration = 1): NoteEvent => ({ id, partId: "p", measureIndex: Math.floor(start), beat: 1, startSeconds: start, durationSeconds: duration, midi, velocity: 0.8, hand: "unknown" });
const timeline = (notes: NoteEvent[], duration = 2): Timeline => ({ version: "v1", durationSeconds: duration, notes, tempos: [], timeSignatures: [], measures: Array.from({ length: duration }, (_, index) => ({ index, number: String(index + 1), startSeconds: index, durationSeconds: 1, beats: 1, beatType: 4, pickup: false })) });

describe("harmonic timeline", () => {
  it("parses major, minor, diminished, augmented and seventh families", () => {
    for (const label of ["C", "Am", "Bdim", "Caug", "Cmaj7", "G7", "Dm7", "Bdim7", "Bm7b5"]) expect(parseChordLabel(label)).not.toBeNull();
  });

  it("uses explicit MusicXML harmony as authoritative", () => {
    const result = buildHarmonicTimeline(timeline([n("x", 61)]), [{ measureIndex: 0, relativePosition: 0, label: "Am" }]);
    expect(result[0]).toMatchObject({ label: "Am", inferred: false, confidence: 1 });
  });

  it("infers C then G7, ignores a short passing note, and sustains one voicing per change", () => {
    const result = buildHarmonicTimeline(timeline([n("c", 60), n("e", 64), n("g", 67), n("pass", 61, 0.25, 0.05), n("g2", 55, 1), n("b", 59, 1), n("d", 62, 1), n("f", 65, 1)]));
    expect(result.map((entry) => entry.label)).toEqual(["C", "G7"]);
    expect(result.every((entry) => entry.pitches.length >= 3 && entry.pitches.length <= 4)).toBe(true);
    expect(activeHarmonyAt(result, 0.5)?.label).toBe("C");
  });

  it("rejects low-confidence unrelated pitch collections", () => {
    expect(buildHarmonicTimeline(timeline([n("a", 60), n("b", 61), n("c", 66), n("d", 68)]))).toHaveLength(0);
  });
});
