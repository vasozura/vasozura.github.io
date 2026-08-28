import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { evaluateAttempt } from "./practice";
import type { Exercise, ScoreManifest } from "./contracts";

const manifest = fixture as ScoreManifest;
const exercise: Exercise = { id: "x", songId: manifest.songId, partIds: ["piano-rh"], fromMeasure: 0, toMeasure: 1, tempoPercent: 100, mode: "continuous", timingToleranceMs: 150 };

describe("deterministic practice evaluation", () => {
  it("matches polyphonic expected notes and reports wrong notes", () => {
    const result = evaluateAttempt(exercise, manifest.timeline.notes, [
      { midi: 67, startedAtMs: 5, durationMs: 620, velocity: 0.8 },
      { midi: 67, startedAtMs: 630, durationMs: 1200, velocity: 0.8 },
      { midi: 71, startedAtMs: 640, durationMs: 1220, velocity: 0.8 },
      { midi: 20, startedAtMs: 800, durationMs: 100, velocity: 0.3 }
    ]);
    expect(result.pitchScore).toBe(100);
    expect(result.wrong).toEqual([20]);
    expect(result.streak).toBe(3);
  });

  it("pauses timing scores when scheduling is unreliable", () => {
    expect(evaluateAttempt(exercise, manifest.timeline.notes, [], false).pausedForTiming).toBe(true);
  });
});
