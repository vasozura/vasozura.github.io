import { describe, expect, it, vi } from "vitest";
import type { InstrumentPlayback } from "../audio/sample-instrument";
import fixture from "./fixtures/complex-score.json";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { CanonicalScheduler } from "./scheduler";
import type { ScoreManifest } from "./contracts";

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
});
