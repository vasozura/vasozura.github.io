import { describe, expect, it, vi } from "vitest";
import { nearestSample, sampledGuitarFiles, sampledPianoFiles, SampleInstrumentEngine } from "./sample-instrument";

function audioParam() {
  return {
    value: 0.1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function audioContext() {
  const bufferSource = {
    buffer: null as AudioBuffer | null,
    playbackRate: { value: 1 },
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    connect: vi.fn().mockReturnThis(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  };
  const oscillator = {
    type: "sine" as OscillatorType,
    frequency: { value: 0 },
    connect: vi.fn().mockReturnThis(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  };
  const gain = { gain: audioParam(), connect: vi.fn().mockReturnThis() };
  const context = {
    currentTime: 2,
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createBufferSource: vi.fn(() => bufferSource),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(async () => ({ duration: 4 }) as AudioBuffer),
  } as unknown as AudioContext;
  return { context, bufferSource, oscillator, gain };
}

describe("sample instrument", () => {
  it("covers the piano with local minor-third sample roots", () => {
    expect(sampledPianoFiles).toHaveLength(26);
    expect(nearestSample(61)).toMatchObject({ midi: 60, file: "C4.mp3" });
    expect(nearestSample(65)).toMatchObject({ midi: 66, file: "Fs4.mp3" });
  });

  it("loads only required roots and plays a velocity-sensitive sampled voice", async () => {
    const { context, bufferSource, oscillator, gain } = audioContext();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const engine = new SampleInstrumentEngine(() => context);
    await engine.enable([60, 61, 66]);
    engine.play({ midi: 61, velocity: 0.75, durationSeconds: 1 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bufferSource.start).toHaveBeenCalledWith(2);
    expect(bufferSource.playbackRate.value).toBeCloseTo(2 ** (1 / 12));
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    expect(oscillator.start).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses the oscillator only if a required local sample cannot load", async () => {
    const { context, oscillator } = audioContext();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const engine = new SampleInstrumentEngine(() => context);
    await engine.enable([21]);
    engine.play({ midi: 21, velocity: 0.5, durationSeconds: 0.5 });

    expect(oscillator.type).toBe("triangle");
    expect(oscillator.start).toHaveBeenCalledWith(2);
    vi.unstubAllGlobals();
  });

  it("loops the same-pitch sample tail for extended Continuous learning notes", async () => {
    const { context, bufferSource } = audioContext();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
    const engine = new SampleInstrumentEngine(() => context);
    await engine.enable([60]);
    engine.play({ midi: 60, velocity: .7, durationSeconds: 8 });
    expect(bufferSource.loop).toBe(true);
    expect(bufferSource.loopEnd).toBeGreaterThan(bufferSource.loopStart);
    vi.unstubAllGlobals();
  });

  it("routes Guitar to the guitar bank and never silently uses piano", async () => {
    const { context, bufferSource, oscillator } = audioContext();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("guitar-acoustic") ? new Uint8Array([1]) : null, { status: url.includes("guitar-acoustic") ? 200 : 404 })));
    const engine = new SampleInstrumentEngine(() => context);
    engine.setInstrument("guitar");
    await engine.enable([64]);
    engine.play({ midi: 64, velocity: 0.8, durationSeconds: 0.4 });
    expect(sampledGuitarFiles).toEqual(["D2.mp3", "C3.mp3", "C4.mp3", "C5.mp3"]);
    expect(engine.currentInstrument).toBe("guitar");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("guitar-acoustic");
    expect(bufferSource.start).toHaveBeenCalled();
    expect(oscillator.start).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports guitar unavailable instead of falling back to piano", async () => {
    const { context, oscillator } = audioContext();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const engine = new SampleInstrumentEngine(() => context);
    engine.setInstrument("guitar");
    await expect(engine.enable([38])).rejects.toThrow("Guitar audio unavailable");
    expect(oscillator.start).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
