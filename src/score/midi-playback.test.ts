import { describe, expect, it, vi } from "vitest";
import { MidiPlayback } from "./midi-playback";
import type { InstrumentPlayback } from "../audio/sample-instrument";

function instrument(): InstrumentPlayback {
  return {
    currentTime: 0,
    enable: vi.fn(async () => undefined),
    play: vi.fn(),
    releaseAll: vi.fn(),
    metronome: vi.fn(),
    setInstrument: vi.fn(),
    destroy: vi.fn(),
  };
}

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

  it("releases sampled voices on pause, seek and loop-sensitive changes", () => {
    const audio = instrument();
    const playback = new MidiPlayback(vi.fn(), vi.fn(), audio);
    (playback as unknown as { duration: number }).duration = 10;
    playback.seek(4);
    playback.setTempo(150);
    playback.stop();
    expect(audio.releaseAll).toHaveBeenCalled();
  });

  it("uses the shared sampled instrument without changing pitch when tempo changes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    const audio = instrument();
    const playback = new MidiPlayback(vi.fn(), vi.fn(), audio);
    (playback as unknown as { notes: unknown[]; duration: number }).notes = [{ time: 0, duration: 1.5, midi: 64, velocity: 0.8 }];
    (playback as unknown as { duration: number }).duration = 10;
    playback.setTempo(150);
    await playback.play();
    (audio as unknown as { currentTime: number }).currentTime = 0.05;
    (playback as unknown as { tick(): void }).tick();

    expect(audio.enable).toHaveBeenCalledWith([64]);
    expect(audio.play).toHaveBeenCalledWith({ midi: 64, velocity: 0.8, durationSeconds: 1 });
    playback.pause();
    expect(audio.releaseAll).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads a derived local track by value and routes piano or guitar timbre without mutating its source", () => {
    const audio = instrument();
    const playback = new MidiPlayback(vi.fn(), vi.fn(), audio);
    const notes = [{ time: 0, duration: 1, midi: 64, velocity: 0.8 }];
    playback.loadEvents(notes, 1, 100);
    playback.setInstrument("guitar");
    notes[0].midi = 1;
    expect((playback as unknown as { notes: Array<{ midi: number }> }).notes[0].midi).toBe(64);
    expect(audio.setInstrument).toHaveBeenCalledWith("guitar");
  });
});
