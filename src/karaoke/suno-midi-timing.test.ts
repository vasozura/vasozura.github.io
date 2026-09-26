import pkg from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { fitMidiToStemMapping, parseSunoVocalMidi } from "./suno-midi-timing";

const { Midi } = pkg as unknown as typeof import("@tonejs/midi");

describe("Suno Vocal MIDI timing", () => {
  it("creates phrase anchors and re-anchors after instrumental gaps", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    const track = midi.addTrack();
    track.name = "Lead Vocal";
    track.addNote({ midi: 60, time: 2, duration: 0.5 });
    track.addNote({ midi: 62, time: 2.8, duration: 0.5 });
    track.addNote({ midi: 64, time: 10, duration: 0.6 });
    track.addNote({ midi: 65, time: 10.9, duration: 0.5 });

    const timing = parseSunoVocalMidi(midi.toArray(), { audioDurationSeconds: 11.4 });
    expect(timing.noteCount).toBe(4);
    expect(timing.phrases).toEqual([{ start: 2, end: 3.3 }, { start: 10, end: 11.4 }]);
    expect(timing.vocalRegions).toHaveLength(2);
    expect(timing.instrumentalGaps[0]).toEqual({ start: 3.3, end: 10 });
    expect(timing.onsets).toEqual([2, 2.8, 10, 10.9]);
  });

  it("rejects a MIDI timeline from a materially different audio source", () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 60, time: 1, duration: 1 });
    expect(() => parseSunoVocalMidi(midi.toArray(), { audioDurationSeconds: 30 })).toThrow(/duration differs/);
  });

  it("fits a monotonic global clock with section-local acoustic anchors", () => {
    const midi = [2, 3, 4, 12, 13, 14];
    const stem = midi.map((time) => time * 1.004 + (time < 8 ? 0.18 : 0.31));
    const mapping = fitMidiToStemMapping({ midiOnsets: midi, stemOnsets: stem, midiDurationSeconds: 20, audioDurationSeconds: 20.08, vocalRegions: [{ start: 2, end: 4 }, { start: 12, end: 14 }] });
    expect(mapping.anchors).toHaveLength(2);
    expect(mapping.p90ResidualMs).toBeLessThanOrEqual(20);
    expect(midi.map(mapping.map)).toEqual([...midi.map(mapping.map)].sort((a, b) => a - b));
  });
});
