import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstrumentPlayback } from "../audio/sample-instrument";
import fixture from "./fixtures/complex-score.json";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { CanonicalScheduler } from "./scheduler";
import type { ScoreManifest } from "./contracts";
import type { NoteEvent } from "./contracts";
import { buildHarmonicTimeline } from "./harmony";
import type { VoiceLane } from "./voice-lanes";

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
  afterEach(() => vi.unstubAllGlobals());
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

  it("applies staff scope to the selected active lane without moving transport", () => {
    const scheduler = new CanonicalScheduler((fixture as ScoreManifest).timeline);
    const adapter = new SchedulerAudioAdapter(scheduler, instrument());
    const notes = [
      { id: "treble", midi: 52, staff: 1, hand: "unknown" },
      { id: "bass", midi: 76, staff: 2, hand: "unknown" },
    ] as NoteEvent[];
    const lane = { id: "lane", notes } as VoiceLane;
    const before = scheduler.snapshot();
    adapter.setSelection({ mode: "solo", voices: 1, scope: "bass" }, [lane], new Set([lane.id]));
    expect(adapter.selectNotes(notes).map((note) => note.id)).toEqual(["bass"]);
    expect(scheduler.snapshot()).toMatchObject({ position: before.position, playing: before.playing });
    adapter.destroy(); scheduler.destroy();
  });

  it("plays one triad voicing per harmonic change instead of every active score note", () => {
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => 0);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    adapter.setHarmonicTimeline(buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]));
    adapter.setLearningLayers({ melody: false, chords: true });
    scheduler.seek(0);
    expect(vi.mocked(output.play).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(output.play).mock.calls.length).toBeLessThanOrEqual(4);
    adapter.destroy(); scheduler.destroy();
  });

  it("plays a guitar arpeggio in selected shape order", () => {
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => 0);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    const harmonies = buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]);
    adapter.setHarmonicTimeline(harmonies);
    adapter.setLearningLayers({ melody: false, chords: true });
    adapter.setInstrument("guitar");
    adapter.setChordPattern("up", "1/8");
    const step = 60 / source.tempos[0].bpm / 2;
    for (let index = 0; index < 4; index += 1) scheduler.seek(index * step);
    const played = vi.mocked(output.play).mock.calls.map(([note]) => note.midi);
    const expected = [...harmonies[0].guitar].sort((a, b) => a.midi - b.midi || b.string - a.string).slice(0, 4).map((note) => note.midi);
    expect(played.slice(-4)).toEqual(expected);
    adapter.destroy(); scheduler.destroy();
  });

  it("queues a live pattern change until the next subdivision without moving transport", () => {
    let now = 0;
    const nextFrame: { value?: FrameRequestCallback } = {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame.value = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => now);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    adapter.setHarmonicTimeline(buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]));
    adapter.setLearningLayers({ melody: false, chords: true });
    scheduler.seek(0.05);
    scheduler.play();
    const before = scheduler.snapshot().position;
    adapter.setChordPattern("bass-12321", "1/8");
    expect(scheduler.snapshot().position).toBe(before);
    expect(adapter.getChordPatternStatus().pattern).toBe("block");
    now = 400;
    nextFrame.value?.(now);
    expect(adapter.getChordPatternStatus().pattern).toBe("bass-12321");
    expect(scheduler.snapshot().position).toBeCloseTo(0.45, 4);
    expect(output.releaseAll).toHaveBeenCalled();
    adapter.destroy(); scheduler.destroy();
  });

  it("mixes melody and chords independently without changing transport position", () => {
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => 0);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    adapter.setHarmonicTimeline(buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]));
    adapter.setLearningLayers({ melody: true, chords: true }, source.notes);
    scheduler.seek(0);
    const mixed = vi.mocked(output.play).mock.calls.length;
    const position = scheduler.snapshot().position;
    adapter.setLearningLayers({ melody: true, chords: false }, source.notes);
    scheduler.seek(0);
    expect(mixed).toBeGreaterThan(1);
    expect(scheduler.snapshot().position).toBe(position);
    adapter.destroy(); scheduler.destroy();
  });

  it("mixes Melody and Chords as independent layers without changing the timeline", () => {
    const source = (fixture as ScoreManifest).timeline;
    const scheduler = new CanonicalScheduler(source, () => 0);
    const output = instrument();
    const adapter = new SchedulerAudioAdapter(scheduler, output);
    adapter.setHarmonicTimeline(buildHarmonicTimeline(source, [{ measureIndex: 0, relativePosition: 0, label: "Am" }]));
    adapter.setLearningLayers({ melody: true, chords: false }, source.notes);
    scheduler.seek(source.notes[0].startSeconds);
    const melodyOnly = vi.mocked(output.play).mock.calls.map(([played]) => played.midi);
    expect(melodyOnly).toContain(source.notes[0].midi);
    vi.mocked(output.play).mockClear();
    adapter.setLearningLayers({ melody: false, chords: true }, source.notes);
    scheduler.seek(0);
    expect(vi.mocked(output.play).mock.calls.length).toBeGreaterThanOrEqual(3);
    vi.mocked(output.play).mockClear();
    adapter.setLearningLayers({ melody: true, chords: true }, source.notes);
    scheduler.seek(0);
    expect(vi.mocked(output.play).mock.calls.map(([played]) => played.midi)).toContain(source.notes[0].midi);
    expect(scheduler.timeline).toBe(source);
    adapter.destroy(); scheduler.destroy();
  });
});
