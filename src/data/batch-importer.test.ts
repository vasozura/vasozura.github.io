import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBatchManifest, runBatch } from "../../scripts/import-batch";

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

  it("rejects duplicate slugs and excessive concurrency", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "zura-batch-"));
    try {
      const filename = path.join(folder, "batch.json");
      await writeFile(filename, JSON.stringify({ schema: "zura-song-batch/v1", concurrency: 8, packages: [{ path: "one", expectedSlug: "same" }, { path: "two", expectedSlug: "same" }] }));
      const inspected = await inspectBatchManifest(filename);
      expect(inspected.issues).toEqual(expect.arrayContaining(["Batch concurrency must be between 1 and 4.", "Batch contains duplicate expected slugs."]));
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("validates every package before any batch write", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "zura-batch-"));
    try {
      for (const slug of ["valid-one", "invalid-two"]) {
        const packageFolder = path.join(folder, slug);
        await mkdir(packageFolder);
        await writeFile(path.join(packageFolder, "metadata.json"), JSON.stringify({ slug, title_ka: "ტესტი", title_en: slug, ...(slug === "invalid-two" ? { status: "published" } : {}) }));
      }
      const filename = path.join(folder, "batch.json");
      await writeFile(filename, JSON.stringify({ schema: "zura-song-batch/v1", concurrency: 2, packages: [{ path: "valid-one", expectedSlug: "valid-one" }, { path: "invalid-two", expectedSlug: "invalid-two" }] }));
      const report = await runBatch(filename, true);
      expect(report.valid).toBe(false);
      expect(report.reports).toHaveLength(2);
      expect(report.aggregate).toMatchObject({ total: 2, valid: 1, failed: 1, uploaded: 0 });
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("detects the same content checksum across different song packages", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "zura-batch-"));
    try {
      for (const slug of ["song-one", "song-two"]) {
        const packageFolder = path.join(folder, slug);
        await mkdir(packageFolder);
        await writeFile(path.join(packageFolder, "metadata.json"), JSON.stringify({ slug, title_ka: "ტესტი", title_en: slug }));
        await writeFile(path.join(packageFolder, "lyrics-en.txt"), "shared placeholder text");
      }
      const filename = path.join(folder, "batch.json");
      await writeFile(filename, JSON.stringify({ schema: "zura-song-batch/v1", packages: [
        { path: "song-one", expectedSlug: "song-one" },
        { path: "song-two", expectedSlug: "song-two" },
      ] }));
      const report = await runBatch(filename, true);
      expect(report.valid).toBe(false);
      expect(report.issues.join("\n")).toContain("Duplicate checksum across song-one/lyrics-en.txt and song-two/lyrics-en.txt.");
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
