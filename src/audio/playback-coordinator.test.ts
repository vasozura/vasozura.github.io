import { describe, expect, it, vi } from "vitest";
import { ignoresTransportShortcut, PlaybackCoordinator } from "./playback-coordinator";
import { CanonicalScheduler } from "../learning/scheduler";
import type { Timeline } from "../learning/contracts";

const transport = (playing = false) => {
  let active = playing;
  return {
    canPlay: () => true,
    isPlaying: () => active,
    play: vi.fn(() => { active = true; }),
    pause: vi.fn(() => { active = false; }),
    stop: vi.fn(() => { active = false; }),
  };
};

describe("playback coordination", () => {
  it("pauses another context before starting the active one", async () => {
    const coordinator = new PlaybackCoordinator();
    const global = transport(true);
    const score = transport();
    coordinator.register("global", global, true);
    coordinator.register("score", score);
    await coordinator.play("score");
    expect(global.pause).toHaveBeenCalledOnce();
    expect(score.play).toHaveBeenCalledOnce();
  });

  it("maps Space to toggle and Escape to reset without handling repeats", async () => {
    const coordinator = new PlaybackCoordinator();
    const score = transport();
    coordinator.register("score", score, true);
    const space = { code: "Space", key: " ", repeat: false, defaultPrevented: false, target: null, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    coordinator.handleKeydown(space);
    await Promise.resolve();
    expect(space.preventDefault).toHaveBeenCalledOnce();
    expect(score.play).toHaveBeenCalledOnce();
    const escape = { code: "Escape", key: "Escape", repeat: false, defaultPrevented: false, target: null, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    coordinator.handleKeydown(escape);
    expect(score.stop).toHaveBeenCalledOnce();
  });

  it("ignores text, select and ordinary button interactions", () => {
    for (const tag of ["input", "select", "textarea", "button", "contenteditable"]) {
      const target = { closest: vi.fn(() => ({ tag })) } as unknown as EventTarget;
      expect(ignoresTransportShortcut(target)).toBe(true);
    }
  });

  it("keeps Space and Escape bound to one active Learning scheduler across its lifecycle", async () => {
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const timeline: Timeline = {
      version: "v1", durationSeconds: 10, notes: [], tempos: [{ atSeconds: 0, bpm: 120, measureIndex: 0 }], timeSignatures: [],
      measures: [{ index: 0, number: "1", startSeconds: 0, durationSeconds: 10, beats: 4, beatType: 4, pickup: false }],
    };
    const coordinator = new PlaybackCoordinator();
    const global = transport();
    let scheduler = new CanonicalScheduler(timeline, () => now);
    coordinator.register("global", global, true);
    const unregister = coordinator.register("learning", {
      canPlay: () => true,
      isPlaying: () => scheduler.snapshot().playing,
      play: () => scheduler.play(),
      pause: () => scheduler.pause(),
      stop: () => scheduler.stop(),
    });
    coordinator.activate("learning");
    const key = (code: string, value: string) => ({ code, key: value, repeat: false, defaultPrevented: false, target: null, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    coordinator.handleKeydown(key("Space", " "));
    await Promise.resolve();
    now = 1_200;
    coordinator.handleKeydown(key("Space", " "));
    await Promise.resolve();
    expect(scheduler.snapshot()).toMatchObject({ playing: false, position: 1.2 });
    coordinator.handleKeydown(key("Space", " "));
    await Promise.resolve();
    expect(scheduler.snapshot().playing).toBe(true);
    coordinator.handleKeydown(key("Escape", "Escape"));
    expect(scheduler.snapshot()).toMatchObject({ playing: false, position: 0 });
    expect(global.play).not.toHaveBeenCalled();
    unregister();
    coordinator.handleKeydown(key("Space", " "));
    await Promise.resolve();
    expect(global.play).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("publishes active playback state without starting duplicate transports", async () => {
    const coordinator = new PlaybackCoordinator();
    const global = transport();
    const learning = transport();
    const states: Array<{ activeId: string | null; playing: boolean }> = [];
    coordinator.subscribe((state) => states.push(state));
    coordinator.register("global", global, true);
    coordinator.register("learning", learning);
    coordinator.activate("learning");
    await coordinator.toggleActive();
    expect(states.at(-1)).toEqual({ activeId: "learning", playing: true });
    expect(learning.play).toHaveBeenCalledOnce();
    expect(global.play).not.toHaveBeenCalled();
  });
});
