import { describe, expect, it } from "vitest";
import { enableMidiSeek } from "./score-viewer";

describe("score viewer MIDI controls", () => {
  it("enables seeking after MIDI has loaded", () => {
    const progress = { disabled: true } as HTMLInputElement;
    enableMidiSeek(progress);
    expect(progress.disabled).toBe(false);
  });

  it("tolerates an unavailable progress control", () => {
    expect(() => enableMidiSeek(null)).not.toThrow();
  });
});
