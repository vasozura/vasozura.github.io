import { describe, expect, it, vi } from "vitest";
import { ignoresTransportShortcut, PlaybackCoordinator } from "./playback-coordinator";

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
});
