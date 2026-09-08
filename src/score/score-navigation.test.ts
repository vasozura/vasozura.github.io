import { describe, expect, it } from "vitest";
import fixture from "../learning/fixtures/complex-score.json";
import type { ScoreManifest } from "../learning/contracts";
import { clientToScorePoint, logicalPageState, nearestScorePosition, resolveCanonicalScoreLocation, resolveCanonicalScorePosition } from "./score-navigation";

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
      { measureIndex: 0, staffIndex: 0, left: 0, right: 100, top: 0, bottom: 80, entries: [{ x: 20, y: 40, left: 18, right: 22, top: 30, bottom: 50, relativePosition: 0 }] },
      { measureIndex: 5, staffIndex: 1, left: 100, right: 300, top: 180, bottom: 260, entries: [{ x: 120, y: 210, left: 118, right: 122, top: 200, bottom: 220, relativePosition: 0 }, { x: 170, y: 210, left: 168, right: 172, top: 200, bottom: 220, relativePosition: 0.5 }] },
    ])).toMatchObject({ measureIndex: 5, staffIndex: 1, relativePosition: 0.5, entryIndex: 1 });
  });

  it("converts client coordinates with the rendered SVG transform rather than a guessed zoom scale", () => {
    const point = clientToScorePoint(310, 220, {
      domToSvg: ({ x, y }) => ({ x: (x - 110) / 2, y: (y - 20) / 2 }),
      svgToOsmd: ({ x, y }) => ({ x: x / 10, y: y / 10 }),
    });
    expect(point).toEqual({ x: 10, y: 10 });
  });

  it("distinguishes treble and bass targets at the same horizontal position", () => {
    const target = (staffIndex: number, top: number) => ({ measureIndex: 2, staffIndex, left: 10, right: 90, top, bottom: top + 30, entries: [{ x: 50, y: top + 15, left: 48, right: 52, top: top + 8, bottom: top + 22, relativePosition: 0.5, midi: staffIndex ? 43 : 72 }] });
    expect(nearestScorePosition(50, 18, [target(0, 0), target(1, 40)])?.staffIndex).toBe(0);
    expect(nearestScorePosition(50, 58, [target(0, 0), target(1, 40)])?.staffIndex).toBe(1);
  });

  it("resolves a graphical click to the nearest canonical note onset", () => {
    const timeline = (fixture as ScoreManifest).timeline;
    const measure = timeline.measures.find((entry) => timeline.notes.some((note) => note.measureIndex === entry.index))!;
    const location = resolveCanonicalScoreLocation(timeline, { measureIndex: measure.index, relativePosition: 0.5 });
    expect([measure.startSeconds, ...timeline.notes.filter((note) => note.measureIndex === measure.index).map((note) => note.startSeconds)]).toContain(location.seconds);
  });
});
