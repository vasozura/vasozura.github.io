import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { guitarCandidates, isVerifiedAccordionConfig } from "./instruments";
import type { ScoreManifest } from "./contracts";

const manifest = fixture as ScoreManifest;

describe("instrument adapters", () => {
  it("preserves explicit guitar fingering as authoritative", () => {
    expect(guitarCandidates(manifest.timeline.notes[4])[0]).toMatchObject({ confidence: "explicit", string: 1, fret: 8 });
  });

  it("labels inferred positions as non-authoritative suggestions", () => {
    const candidates = guitarCandidates(manifest.timeline.notes[0]);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((entry) => entry.confidence === "suggestion")).toBe(true);
  });

  it("accepts only an explicitly verified accordion mapping", () => {
    expect(isVerifiedAccordionConfig({ system: "stradella", verified: true, rightHandMidi: [60], bassButtons: [{ id: "C", midi: 36 }] })).toBe(true);
    expect(isVerifiedAccordionConfig({ system: "stradella", rightHandMidi: [60], bassButtons: [] })).toBe(false);
    expect(isVerifiedAccordionConfig({ system: "invented", verified: true, rightHandMidi: [60], bassButtons: [] })).toBe(false);
  });
});
