import { describe, expect, it } from "vitest";
import { activeTimelineForTrack, chooseSessionMelody, compareTrack, inspectMidiSource, melodyContourPoints, parseMidiFiles, timelineForTrack, type MidiLike } from "./midi-inspector";

const midi = (tracks: MidiLike["tracks"], duration = 8): MidiLike => ({ duration, header: { tempos: [{ bpm: 120 }] }, tracks });
const track = (name: string, notes: Array<{ time: number; duration: number; midi: number }>) => ({ name, channel: 0, instrument: { name: "Piano" }, notes });

describe("MIDI inspector", () => {
  it("retains every track, including unnamed tracks, and classifies explicit vocal sources", () => {
    const source = inspectMidiSource("reference.mid", midi([
      track("Vocal", [{ time: 0, duration: 1, midi: 64 }]),
      track("", [{ time: 0, duration: 1, midi: 40 }, { time: 0, duration: 1, midi: 47 }]),
    ]));
    expect(source.tracks).toHaveLength(2);
    expect(source.tracks[0]).toMatchObject({ rank: "Likely Vocal", explicitVocal: true });
    expect(source.tracks[1].name).toBe("Unnamed track");
  });

  it("parses several local session files without uploading or persisting them", async () => {
    const files = ["a.mid", "b.midi", "c.mid"].map((name) => ({ name, arrayBuffer: async () => new ArrayBuffer(1) })) as File[];
    const sources = await parseMidiFiles(files, () => midi([track("Lead", [{ time: 0, duration: 1, midi: 67 }])], 1));
    expect(sources.map((source) => source.name)).toEqual(["a.mid", "b.midi", "c.mid"]);
    expect(JSON.stringify(sources)).not.toContain("supabase");
  });

  it("makes manual Vocal selection authoritative over heuristic candidates", () => {
    const source = inspectMidiSource("ref.mid", midi([
      track("Vocal", [{ time: 0, duration: 1, midi: 72 }]),
      track("Chosen", [{ time: 0, duration: 1, midi: 55 }]),
    ]));
    expect(chooseSessionMelody(source.tracks[1], source.tracks)).toBe(source.tracks[1]);
    expect(melodyContourPoints(source.tracks[1]).map((point) => point.midi)).toEqual([55]);
  });

  it("uses the exact manually selected notes for Active timing and leaves canonical data unchanged", () => {
    const source = inspectMidiSource("ref.mid", midi([track("Chosen", [
      { time: 0, duration: 0.4, midi: 60 }, { time: 2.8, duration: 0.4, midi: 62 }, { time: 3.35, duration: 0.4, midi: 64 },
    ])], 4));
    const canonical = timelineForTrack(source.tracks[0]);
    const before = JSON.stringify(canonical);
    const active = activeTimelineForTrack(source.tracks[0], 120, 0.6, 0.2);
    expect(active.timeline.notes.map((note) => note.midi)).toEqual([60, 62, 64]);
    expect(active.timeline.notes[1].startSeconds).toBeCloseTo(0.6);
    expect(active.timeline.notes[2].startSeconds - (active.timeline.notes[1].startSeconds + 0.4)).toBeCloseTo(0.15);
    expect(JSON.stringify(canonical)).toBe(before);
  });

  it("reports source alignment diagnostics without changing either timeline", () => {
    const source = inspectMidiSource("ref.mid", midi([track("Melody", [{ time: 0, duration: 1, midi: 60 }])], 4));
    const canonical = { ...timelineForTrack(source.tracks[0]), durationSeconds: 12 };
    expect(compareTrack(source.tracks[0], canonical, source.bpm)).toMatchObject({ aligned: false, durationDifferenceSeconds: -11 });
  });
});
