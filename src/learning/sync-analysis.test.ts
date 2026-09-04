import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import type { ScoreManifest } from "./contracts";
import { assessSynchronization } from "./sync-analysis";

const timeline = (fixture as ScoreManifest).timeline;

describe("score and MIDI synchronization assessment", () => {
  it("accepts tiny deterministic duration differences", () => {
    expect(assessSynchronization(timeline, timeline.durationSeconds + 0.02).confidence).toBe("high");
  });

  it("normalizes bounded differences to the canonical clock", () => {
    expect(assessSynchronization(timeline, timeline.durationSeconds + 0.5).confidence).toBe("medium");
  });

  it("warns instead of claiming synchronization for incompatible timing", () => {
    const result = assessSynchronization(timeline, timeline.durationSeconds * 2);
    expect(result.confidence).toBe("unreliable");
    expect(result.message).toContain("canonical");
  });
});
