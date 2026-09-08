import { describe, expect, it } from "vitest";
import fixture from "../learning/fixtures/complex-score.json";
import type { ScoreManifest } from "../learning/contracts";
import { logicalPageState, nearestScorePosition, resolveCanonicalScoreLocation, resolveCanonicalScorePosition } from "./score-navigation";

describe("score navigation", () => {
  it("paginates a single tall OSMD surface logically", () => {
    expect(logicalPageState(610, 600, 1750)).toEqual({ index: 1, count: 3, top: 600 });
    expect(logicalPageState(9999, 600, 1750)).toEqual({ index: 2, count: 3, top: 1200 });
  });

  it("snaps score clicks to the canonical timeline", () => {
    const timeline = (fixture as ScoreManifest).timeline;
    const position = resolveCanonicalScorePosition(timeline, 0.5);
    expect([0, timeline.durationSeconds, ...timeline.notes.map((note) => note.startSeconds), ...timeline.measures.map((measure) => measure.startSeconds)]).toContain(position);
  });

  it("chooses the nearest graphical measure and staff entry", () => {
    expect(nearestScorePosition(160, 210, [
      { measureIndex: 0, left: 0, right: 100, top: 0, bottom: 80, entries: [{ x: 20, relativePosition: 0 }] },
      { measureIndex: 5, left: 100, right: 300, top: 180, bottom: 260, entries: [{ x: 120, relativePosition: 0 }, { x: 170, relativePosition: 0.5 }] },
    ])).toEqual({ measureIndex: 5, relativePosition: 0.5 });
  });

  it("resolves a graphical click to the nearest canonical note onset", () => {
    const timeline = (fixture as ScoreManifest).timeline;
    const measure = timeline.measures.find((entry) => timeline.notes.some((note) => note.measureIndex === entry.index))!;
    const location = resolveCanonicalScoreLocation(timeline, { measureIndex: measure.index, relativePosition: 0.5 });
    expect([measure.startSeconds, ...timeline.notes.filter((note) => note.measureIndex === measure.index).map((note) => note.startSeconds)]).toContain(location.seconds);
  });
});
