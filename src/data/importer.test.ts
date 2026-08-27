import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSongPackage, isDuplicateChecksum, runImport } from "../../scripts/import-song";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

async function makePackage(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "zura-import-"));
  folders.push(folder);
  await writeFile(path.join(folder, "metadata.json"), JSON.stringify({ slug: "test-song", title_ka: "ტესტი", title_en: "Test", status: "draft" }));
  await writeFile(path.join(folder, "lyrics-ka.txt"), "first\\nsecond", "utf8");
  return folder;
}

describe("local importer", () => {
  it("validates and reports a dry run without credentials", async () => {
    const report = await runImport(await makePackage(), true);
    expect(report.valid).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.skipped[0]).toMatch(/lyrics-ka\.txt \([a-f0-9]{64}\)/);
  });

  it("rejects unexpected files before upload", async () => {
    const folder = await makePackage();
    await writeFile(path.join(folder, "unknown.bin"), "bad");
    const result = await inspectSongPackage(folder);
    expect(result.issues).toContain("Unexpected file: unknown.bin");
  });

  it("detects a checksum that has already been processed", () => {
    expect(isDuplicateChecksum("abc", ["def", "abc"])).toBe(true);
    expect(isDuplicateChecksum("new", ["def", "abc"])).toBe(false);
  });
});
