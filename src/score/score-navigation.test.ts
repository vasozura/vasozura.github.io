import { describe, expect, it } from "vitest";
import fixture from "../learning/fixtures/complex-score.json";
import type { ScoreManifest } from "../learning/contracts";
import { logicalPageState, resolveCanonicalScorePosition } from "./score-navigation";

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
});
