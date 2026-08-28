import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { CanonicalScheduler } from "./scheduler";
import type { ScoreManifest } from "./contracts";

const manifest = fixture as ScoreManifest;
let now = 0;

beforeEach(() => {
  now = 0;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("canonical scheduler", () => {
  it("derives position from a stable clock instead of accumulating timer drift", () => {
    const scheduler = new CanonicalScheduler(manifest.timeline, () => now);
    scheduler.play(); now = 1000; scheduler.pause();
    expect(scheduler.snapshot().position).toBeCloseTo(1, 4);
    scheduler.setTempo(150); scheduler.play(); now = 2000; scheduler.pause();
    expect(scheduler.snapshot().position).toBeCloseTo(2.5, 4);
  });

  it("wraps an A-B measure loop without losing overshoot", () => {
    const scheduler = new CanonicalScheduler(manifest.timeline, () => now);
    scheduler.setMeasureLoop(1, 1); scheduler.seek(3); scheduler.play(); now = 500; scheduler.pause();
    expect(scheduler.snapshot().position).toBeCloseTo(1, 4);
  });

  it("reports tempo changes and pickup measure data from the same timeline", () => {
    const scheduler = new CanonicalScheduler(manifest.timeline, () => now);
    expect(scheduler.snapshot().measure?.pickup).toBe(true);
    scheduler.seek(3.2);
    expect(scheduler.snapshot().measure?.index).toBe(2);
    expect(manifest.timeline.tempos).toHaveLength(2);
  });
});
