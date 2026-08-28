import { describe, expect, it } from "vitest";
import valid from "./fixtures/complex-score.json";
import invalid from "./fixtures/invalid-score.json";
import { assertScoreManifest, isScoreManifest } from "./contracts";

describe("Learning API v1 contract", () => {
  it("accepts the complex canonical fixture", () => expect(isScoreManifest(valid)).toBe(true));
  it("rejects malformed or incompatible payloads", () => expect(() => assertScoreManifest(invalid)).toThrow("contract v1"));
});
