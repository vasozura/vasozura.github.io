import { describe, expect, it } from "vitest";
import { parseLearningConfiguration, validateLearningPublication } from "./admin-config";
import type { Song } from "../types/song";

describe("learning admin configuration", () => {
  it("validates and parses opt-in mappings", () => {
    const data = new FormData();
    data.set("learning_enabled", "on"); data.append("learning_instrument", "piano"); data.set("learning_source", "musicxml"); data.set("learning_mapping", '{"part-1":"right"}'); data.set("learning_fingering", "{}");
    expect(parseLearningConfiguration(data)).toMatchObject({ enabled: true, instruments: ["piano"], source: "musicxml", mapping: { "part-1": "right" } });
  });

  it("rejects invalid JSON and enabled configurations without an instrument", () => {
    const invalid = new FormData(); invalid.set("learning_mapping", "[]");
    expect(() => parseLearningConfiguration(invalid)).toThrow("JSON object");
    const empty = new FormData(); empty.set("learning_enabled", "on");
    expect(() => parseLearningConfiguration(empty)).toThrow("at least one");
  });

  it("blocks publishing an enabled mapping without its selected source", () => {
    const song = { learningEnabled: true, learningInstruments: ["piano"], learningSource: "musicxml", musicXmlUrl: null } as Song;
    expect(() => validateLearningPublication(song)).toThrow("MusicXML");
  });

  it("blocks accordion publication without a verified mapping", () => {
    const song = { learningEnabled: true, learningInstruments: ["accordion"], learningSource: "musicxml", musicXmlUrl: "https://example.com/score.musicxml", learningMapping: {} } as Song;
    expect(() => validateLearningPublication(song)).toThrow("verified zura-accordion-mapping/v1");
  });
});
