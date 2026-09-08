import { describe, expect, it, vi } from "vitest";
import { enableMidiSeek, fetchScoreSource, getScoreCopy, osmdViewerOptions, scoreTargetsFromGraphicalMeasures, scoreWidthChanged, shouldMountStandaloneMidi } from "./score-viewer";

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

  it("rerenders only for meaningful score workspace width changes", () => {
    expect(scoreWidthChanged(0, 900)).toBe(true);
    expect(scoreWidthChanged(900, 904)).toBe(false);
    expect(scoreWidthChanged(900, 920)).toBe(true);
  });

  it("keeps OSMD resize and page-follow movement under application control", () => {
    expect(osmdViewerOptions).toMatchObject({ autoResize: false, followCursor: false });
  });

  it("extracts graphical score hit targets and source-authored harmony", () => {
    const result = scoreTargetsFromGraphicalMeasures([[{
      PositionAndShape: { AbsolutePosition: { x: 2, y: 3 }, BorderLeft: 0, BorderRight: 12, BorderTop: 0, BorderBottom: 5 },
      ParentMusicSystem: { Parent: { PositionAndShape: { AbsolutePosition: { x: 0, y: 20 } } } },
      parentSourceMeasure: { measureListIndex: 4, Duration: { RealValue: 1 } },
      staffEntries: [{ PositionAndShape: { AbsolutePosition: { x: 7, y: 3 } }, relInMeasureTimestamp: { RealValue: 0.5 }, graphicalChordContainers: [{ GraphicalLabel: { Label: { text: "Am" } } }] }],
    }]], 10);
    expect(result.targets[0]).toMatchObject({ measureIndex: 4, left: 20, right: 140, top: 230, bottom: 280 });
    expect(result.harmonies).toEqual([{ measureIndex: 4, relativePosition: 0.5, label: "Am" }]);
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
