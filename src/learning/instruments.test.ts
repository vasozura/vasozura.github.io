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
    expect(isVerifiedAccordionConfig({
      schema_version: "zura-accordion-mapping/v1",
      layout_id: "verified-stradella",
      system: "stradella",
      orientation: "vertical",
      row_direction: "top_to_bottom",
      row_count: 6,
      verified: true,
      buttons: [{ id: "C-major", side: "left", row: 3, column: 4, midi: [48, 52, 55], kind: "major", provenance: "source", confidence: 1 }],
    })).toBe(true);
    expect(isVerifiedAccordionConfig({ system: "stradella", verified: true, rightHandMidi: [60], bassButtons: [{ id: "C", midi: 36 }] })).toBe(true);
    expect(isVerifiedAccordionConfig({ system: "stradella", rightHandMidi: [60], bassButtons: [] })).toBe(false);
    expect(isVerifiedAccordionConfig({ system: "invented", verified: true, rightHandMidi: [60], bassButtons: [] })).toBe(false);
  });

  it("rejects duplicate, out-of-row and invented accordion assertions", () => {
    const base = { schema_version: "zura-accordion-mapping/v1", layout_id: "c-system", system: "chromatic_button", orientation: "vertical", row_direction: "top_to_bottom", row_count: 3, verified: true };
    const button = { id: "r1-c1", side: "right", row: 1, column: 1, midi: [60], provenance: "source", confidence: 1 };
    expect(isVerifiedAccordionConfig({ ...base, buttons: [button, button] })).toBe(false);
    expect(isVerifiedAccordionConfig({ ...base, buttons: [{ ...button, row: 4 }] })).toBe(false);
    expect(isVerifiedAccordionConfig({ ...base, buttons: [{ ...button, provenance: "inferred", confidence: .5, bellows: "push" }] })).toBe(false);
  });
});
