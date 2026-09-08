import { describe, expect, it, vi } from "vitest";
import type { InstrumentPlayback } from "../audio/sample-instrument";
import fixture from "./fixtures/complex-score.json";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { CanonicalScheduler } from "./scheduler";
import type { ScoreManifest } from "./contracts";
import type { NoteEvent } from "./contracts";
import { buildHarmonicTimeline } from "./harmony";

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

describe("learning audio adapter", () => {
  it("uses the shared sample layer and releases voices on reset", async () => {
    const scheduler = new CanonicalScheduler((fixture as ScoreManifest).timeline);
    const audio = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, audio);
    await adapter.enable();
    adapter.setInstrument("piano");
    adapter.reset();

    expect(audio.enable).toHaveBeenCalledWith(scheduler.timeline.notes.map((note) => note.midi));
    expect(audio.setInstrument).toHaveBeenCalledWith("piano");
    expect(audio.releaseAll).toHaveBeenCalled();
    adapter.destroy();
    scheduler.destroy();
  });

  it("switches between derived harmony and scoped solo voices without remounting", () => {
    const scheduler = new CanonicalScheduler((fixture as ScoreManifest).timeline);
    const audio = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, audio);
    const notes = [
      { id: "low", midi: 48, hand: "left" },
      { id: "high", midi: 76, hand: "right" },
    ] as NoteEvent[];
    expect(adapter.selectNotes(notes)).toEqual([]);
    adapter.setSelection({ mode: "solo", voices: 1, scope: "treble" });
    expect(adapter.selectNotes(notes).map((note) => note.id)).toEqual(["high"]);
    expect(audio.releaseAll).toHaveBeenCalled();
    adapter.destroy(); scheduler.destroy();
  });

  it("plays one triad voicing per harmonic change instead of every active score note", () => {
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => 0);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    adapter.setHarmonicTimeline(buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]));
    scheduler.seek(0);
    expect(vi.mocked(output.play).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(output.play).mock.calls.length).toBeLessThanOrEqual(4);
    adapter.destroy(); scheduler.destroy();
  });
});
