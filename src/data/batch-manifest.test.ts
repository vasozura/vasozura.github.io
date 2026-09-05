import { describe, expect, it } from "vitest";
import { parseBatchManifest, validateBatchManifest } from "./batch-manifest";

describe("admin batch readiness", () => {
  it("accepts a bounded synthetic batch", () => {
    const result = validateBatchManifest({ schema: "zura-song-batch/v1", concurrency: 2, packages: [{ path: "packages/synthetic", expectedSlug: "synthetic-song" }] });
    expect(result).toMatchObject({ valid: true });
  });

  it("groups malformed and duplicate entries without writing", () => {
    const result = validateBatchManifest({ schema: "zura-song-batch/v1", concurrency: 9, packages: [{ path: "", expectedSlug: "same" }, { path: "two", expectedSlug: "same" }] });
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining(["Concurrency must be between 1 and 4.", "Package path is required.", "Duplicate slugs are not allowed."]));
  });

  it("rejects invalid JSON", () => {
    expect(parseBatchManifest("{").errors[0].message).toBe("Manifest contains invalid JSON.");
  });
});
