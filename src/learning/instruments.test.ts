import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { chooseContinuousGuitarPosition, guitarCandidates, guitarFretLabels, guitarStringLayout, isVerifiedAccordionConfig, pianoAccordionRightHandKeys, PIANO_ACCORDION_MAX_MIDI, PIANO_ACCORDION_MIN_MIDI, standardPianoAccordionConfig } from "./instruments";
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

  it("keeps vocal pitch exact and reports no guitar position when out of range", () => {
    const high = { ...manifest.timeline.notes[0], midi: 108 };
    expect(guitarCandidates(high)).toEqual([]);
    expect(high.midi).toBe(108);
  });

  it("uses conventional guitar string numbering for exact playable pitches", () => {
    const e4 = { ...manifest.timeline.notes[0], midi: 64, string: undefined, fret: undefined };
    expect(guitarCandidates(e4)[0]).toMatchObject({ string: 1, fret: 0, confidence: "suggestion" });
  });

  it("renders string 1 high E first, string 6 low E last, with one fret header", () => {
    const layout = guitarStringLayout();
    expect(layout[0]).toEqual({ string: 1, openMidi: 64 });
    expect(layout.at(-1)).toEqual({ string: 6, openMidi: 40 });
    expect(guitarFretLabels()).toEqual(Array.from({ length: 21 }, (_, index) => index));
  });

  it("prefers a continuous playable fingering path instead of independently minimizing every fret", () => {
    const previous = { string: 1, fret: 10 };
    const position = chooseContinuousGuitarPosition({ ...manifest.timeline.notes[0], id: "continuity", midi: 69, string: undefined, fret: undefined }, previous);
    expect(position).toMatchObject({ string: 2, fret: 10 });
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

  it("maps the verified 41-key piano-accordion right hand exactly from F3 through A6", () => {
    const keys = pianoAccordionRightHandKeys();
    expect([PIANO_ACCORDION_MIN_MIDI, PIANO_ACCORDION_MAX_MIDI]).toEqual([53, 93]);
    expect(keys).toHaveLength(41);
    expect(keys[0]).toMatchObject({ id: "rh-53", midi: [53], label: "F 3", side: "right", row: 1, column: 1, provenance: "deterministic" });
    expect(keys.at(-1)).toMatchObject({ id: "rh-93", midi: [93], label: "A 6", column: 41 });
    expect(keys.map((key) => key.midi[0])).toEqual(Array.from({ length: 41 }, (_, index) => 53 + index));
    expect(isVerifiedAccordionConfig(standardPianoAccordionConfig)).toBe(true);
    expect(pianoAccordionRightHandKeys(52, 93)).toEqual([]);
    expect(pianoAccordionRightHandKeys(53, 94)).toEqual([]);
  });
});
