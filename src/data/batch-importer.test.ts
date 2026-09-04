import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBatchManifest } from "../../scripts/import-batch";

describe("batch import manifest", () => {
  it("accepts the versioned format and rejects unknown schemas", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "zura-batch-"));
    try {
      const valid = path.join(folder, "valid.json");
      const invalid = path.join(folder, "invalid.json");
      await writeFile(valid, JSON.stringify({ schema: "zura-song-batch/v1", packages: [{ path: "one", expectedSlug: "one" }] }));
      await writeFile(invalid, JSON.stringify({ schema: "future", packages: [] }));
      expect((await inspectBatchManifest(valid)).manifest?.packages).toHaveLength(1);
      expect((await inspectBatchManifest(invalid)).issues).toContain("Unsupported batch schema.");
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
