import { describe, expect, it } from "vitest";
import type { NoteEvent, ScoreManifest } from "./contracts";
import { buildActiveTrackOptions, buildVoiceLanes, resolveActiveTrack, selectLaneNotes, selectMelodyLane } from "./voice-lanes";

const note = (id: string, partId: string, startSeconds: number, midi: number, voice?: string): NoteEvent => ({ id, partId, measureIndex: 0, beat: 1 + startSeconds, startSeconds, durationSeconds: 0.4, midi, velocity: 0.8, hand: "unknown", staff: 1, voice });
const manifest = (name: string, notes: NoteEvent[]): ScoreManifest => ({ version: "v1", songId: "s", sourceChecksum: "x", generatedAt: new Date(0).toISOString(), parts: [{ id: "p", name, instrument: name, midiChannel: 0, hand: "unknown" }], timeline: { version: "v1", durationSeconds: 4, notes, tempos: [], timeSignatures: [], measures: [{ index: 0, number: "1", startSeconds: 0, durationSeconds: 4, beats: 4, beatType: 4, pickup: false }] }, warnings: [] });

describe("voice lanes", () => {
  it("keeps persistent explicit part/staff/voice lanes", () => {
    const value = manifest("Piano", [note("a", "p", 0, 60, "1"), note("b", "p", 0, 48, "2"), note("c", "p", 1, 62, "1")]);
    const lanes = buildVoiceLanes(value);
    expect(lanes).toHaveLength(2);
    expect(lanes.find((lane) => lane.voice === "1")?.notes.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("uses an explicit Vocal part before inferred melody", () => {
    const value = manifest("Lead Vocal", [note("a", "p", 0, 64, "1"), note("b", "p", 1, 65, "1")]);
    const lane = selectMelodyLane(value);
    expect(lane?.label).toContain("Lead Vocal");
    expect(lane?.inferred).toBe(false);
  });

  it("labels deterministic fallback melody as inferred and selects it continuously", () => {
    const value = manifest("Piano", [note("a", "p", 0, 72, "1"), note("b", "p", 1, 74, "1"), note("c", "p", 0, 48, "2")]);
    const lanes = buildVoiceLanes(value);
    const lane = selectMelodyLane(value, lanes)!;
    expect(lane.label).toBe("Melody · inferred");
    expect(selectLaneNotes(value.timeline.notes, lanes, new Set([lane.id])).map((entry) => entry.id)).toEqual(lane.notes.map((entry) => entry.id));
  });

  it("resolves only available active tracks with a deterministic fallback", () => {
    const notes = [note("v", "vocal", 0, 67, "1"), note("p", "piano", 0, 60, "1"), note("g", "guitar", 0, 55, "1")];
    const value: ScoreManifest = {
      ...manifest("unused", notes),
      parts: [
        { id: "vocal", name: "Lead Vocal", instrument: "Voice", midiChannel: 0, hand: "unknown" },
        { id: "piano", name: "Piano", instrument: "Acoustic Grand Piano", midiChannel: 1, hand: "unknown" },
        { id: "guitar", name: "Guitar", instrument: "Nylon Guitar", midiChannel: 2, hand: "unknown" },
      ],
    };
    const lanes = buildVoiceLanes(value);
    const options = buildActiveTrackOptions(value, lanes, selectMelodyLane(value, lanes));
    expect(options.map((option) => option.id)).toEqual(["melody", "piano", "guitar"]);
    expect(resolveActiveTrack("guitar", options)).toMatchObject({ option: { id: "guitar" }, usedFallback: false });
    expect(resolveActiveTrack("guitar", options.filter((option) => option.id !== "guitar"))).toMatchObject({ option: { id: "melody" }, usedFallback: true });
  });
});
