import { describe, expect, it, vi } from "vitest";
import { enableMidiSeek, fetchScoreSource, getScoreCopy, shouldMountStandaloneMidi } from "./score-viewer";

describe("score viewer MIDI controls", () => {
  it("disables the independent MIDI timer when the canonical learning clock is active", () => {
    expect(shouldMountStandaloneMidi({ midiPlayback: false })).toBe(false);
    expect(shouldMountStandaloneMidi({})).toBe(true);
  });
  it("enables seeking after MIDI has loaded", () => {
    const progress = { disabled: true } as HTMLInputElement;
    enableMidiSeek(progress);
    expect(progress.disabled).toBe(false);
  });

  it("tolerates an unavailable progress control", () => {
    expect(() => enableMidiSeek(null)).not.toThrow();
  });

  it("keeps score and transport controls bilingual", () => {
    expect(getScoreCopy("ka")).toMatchObject({ loaded: "MusicXML ნოტები ჩაიტვირთა.", cursor: "კურსორი" });
    expect(getScoreCopy("en")).toMatchObject({ loaded: "MusicXML score loaded.", cursor: "Cursor" });
  });
});

describe("score viewer MusicXML loading", () => {
  it("prefetches a signed resource as a Blob before OSMD parses it", async () => {
    const request = vi.fn(async () => new Response("<?xml version=\"1.0\"?><score-partwise/>", {
      status: 200,
      headers: { "content-type": "application/vnd.recordare.musicxml+xml" },
    }));

    const source = await fetchScoreSource("https://storage.example/score.musicxml?token=private", request);

    expect(request).toHaveBeenCalledWith("https://storage.example/score.musicxml?token=private", { credentials: "omit" });
    expect(source).toBeInstanceOf(Blob);
    expect(await source.text()).toContain("score-partwise");
  });

  it("reports an HTTP failure without passing an invalid source to OSMD", async () => {
    const request = vi.fn(async () => new Response("denied", { status: 403 }));

    await expect(fetchScoreSource("https://storage.example/score.musicxml", request)).rejects.toThrow("MusicXML unavailable (403)");
  });
});
