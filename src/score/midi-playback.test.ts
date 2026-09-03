import { describe, expect, it, vi } from "vitest";
import { MidiPlayback } from "./midi-playback";

describe("MIDI playback seeking", () => {
  it("clamps and reports a seek without starting playback", () => {
    const onNotes = vi.fn();
    const onPosition = vi.fn();
    const playback = new MidiPlayback(onNotes, onPosition);
    (playback as unknown as { duration: number }).duration = 10;

    playback.seek(4.5);
    playback.seek(20);

    expect(onNotes).toHaveBeenCalledTimes(2);
    expect(onPosition).toHaveBeenNthCalledWith(1, 4.5, 10);
    expect(onPosition).toHaveBeenNthCalledWith(2, 10, 10);
    expect(playback.isPlaying()).toBe(false);
  });
});
