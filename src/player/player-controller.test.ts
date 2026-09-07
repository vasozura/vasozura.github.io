import { describe, expect, it, vi } from "vitest";
import { PlayerController, resetAudioPosition } from "./player-controller";

describe("global player Stop", () => {
  it("pauses and resets the same selected media without advancing", () => {
    const audio = { pause: vi.fn(), currentTime: 73 };
    resetAudioPosition(audio);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });

  it("does not duplicate control handlers when the catalog refreshes", () => {
    class FakeAudio extends EventTarget {
      preload = ""; src = ""; currentTime = 12; duration = 100; volume = 1; paused = false;
      pause = vi.fn(() => { this.paused = true; });
      play = vi.fn(async () => { this.paused = false; });
    }
    const audio = new FakeAudio();
    vi.stubGlobal("Audio", class { constructor() { return audio; } });
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    const stop = new EventTarget();
    const root = {
      querySelector: (selector: string) => selector === "#player-stop" ? stop : null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const player = new PlayerController();
    (player as unknown as { currentId: string }).currentId = "selected-song";
    player.bind(root, [], "en");
    player.bind(root, [], "en");
    stop.dispatchEvent(new Event("click"));
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(JSON.parse(setItem.mock.lastCall?.[1] as string)).toMatchObject({ currentId: "selected-song", position: 0 });
    vi.unstubAllGlobals();
  });
});
