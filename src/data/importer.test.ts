import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectSongPackage,
  isDuplicateChecksum,
  isTrustedServerCredential,
  mapMetadataToSongRow,
  markImportFailure,
  runImport,
  type ImportMetadata,
  type ImportReport,
} from "../../scripts/import-song";

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function makePackage(metadata: Partial<ImportMetadata> = {}): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "zura-import-"));
  folders.push(folder);
  await writeFile(
    path.join(folder, "metadata.json"),
    JSON.stringify({
      slug: "test-song",
      title_ka: "ტესტი",
      title_en: "Test",
      status: "draft",
      ...metadata,
    }),
  );
  await writeFile(path.join(folder, "lyrics-ka.txt"), "first\\nsecond", "utf8");
  return folder;
}

async function addInstrumentParts(folder: string): Promise<void> {
  const parts = path.join(folder, "instrument-parts");
  await mkdir(parts);
  const xml = '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>';
  const midi = Buffer.concat([Buffer.from("MThd"), Buffer.alloc(12)]);
  await Promise.all([
    writeFile(path.join(folder, "score.musicxml"), xml),
    writeFile(path.join(parts, "piano.musicxml"), xml),
    writeFile(path.join(parts, "guitar.musicxml"), xml),
    writeFile(path.join(parts, "piano.mid"), midi),
    writeFile(path.join(parts, "guitar.mid"), midi),
  ]);
}

async function addChecksumManifest(folder: string): Promise<void> {
  const relativeFiles = [
    "metadata.json",
    "lyrics-ka.txt",
    "UPLOAD_NOTES.txt",
    "score.musicxml",
    "instrument-parts/piano.musicxml",
    "instrument-parts/piano.mid",
    "instrument-parts/guitar.musicxml",
    "instrument-parts/guitar.mid",
  ];
  const lines: string[] = [];
  for (const relative of relativeFiles) {
    const buffer = await readFile(path.join(folder, ...relative.split("/")));
    lines.push(`${createHash("sha256").update(buffer).digest("hex")}  /build/song/${relative}`);
  }
  await writeFile(path.join(folder, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

describe("local importer", () => {
  it("preserves legacy flat-package dry runs", async () => {
    const report = await runImport(await makePackage(), true);
    expect(report).toMatchObject({ valid: true, dryRun: true, partial: false });
    expect(report.skipped[0]).toMatch(/lyrics-ka\.txt \([a-f0-9]{64}\)/);
  });

  it("accepts nested piano and guitar MusicXML/MIDI parts", async () => {
    const folder = await makePackage({
      learning_enabled: true,
      learning_instruments: ["piano", "guitar"],
      canonical_source: "musicxml",
    });
    await addInstrumentParts(folder);
    const result = await inspectSongPackage(folder);
    expect(result.issues).toEqual([]);
    expect(result.files.filter((file) => file.fileType === "instrument_part")).toHaveLength(4);
    expect(result.files.map((file) => [file.instrument, file.partKind])).toEqual(
      expect.arrayContaining([
        ["piano", "musicxml"],
        ["piano", "midi"],
        ["guitar", "musicxml"],
        ["guitar", "midi"],
      ]),
    );
  });

  it("recognizes auxiliary notes and verifies a valid checksum manifest", async () => {
    const folder = await makePackage({
      learning_enabled: true,
      learning_instruments: ["piano", "guitar"],
      canonical_source: "musicxml",
    });
    await addInstrumentParts(folder);
    await writeFile(path.join(folder, "UPLOAD_NOTES.txt"), "owner notes\n");
    await addChecksumManifest(folder);
    const report = await runImport(folder, true);
    expect(report.valid).toBe(true);
    expect(report.skipped).toHaveLength(6);
    expect(report.skipped.join("\n")).not.toMatch(/SHA256SUMS|UPLOAD_NOTES/);
  });

  it("rejects checksum mismatches before any write", async () => {
    const folder = await makePackage({
      learning_enabled: true,
      learning_instruments: ["piano", "guitar"],
      canonical_source: "musicxml",
    });
    await addInstrumentParts(folder);
    await writeFile(path.join(folder, "UPLOAD_NOTES.txt"), "owner notes\n");
    await addChecksumManifest(folder);
    await writeFile(path.join(folder, "lyrics-ka.txt"), "tampered");
    const report = await runImport(folder, true);
    expect(report.valid).toBe(false);
    expect(report.issues).toContain("Checksum mismatch: lyrics-ka.txt.");
    expect(report.uploaded).toEqual([]);
  });

  it("maps package learning metadata to application database columns", () => {
    const metadata: ImportMetadata = {
      slug: "learning-song",
      title_ka: "სწავლა",
      title_en: "Learning",
      learning_enabled: true,
      learning_instruments: ["piano", "guitar"],
      canonical_source: "musicxml",
      part_mapping: { P1: "piano" },
      fingering_overrides: { guitar: { string: 2, fret: 3 } },
      duration_seconds: 261.048,
    };
    expect(mapMetadataToSongRow(metadata, "lyrics", null, "a".repeat(64))).toMatchObject({
      status: "draft",
      learning_enabled: true,
      learning_instruments: ["piano", "guitar"],
      learning_source_type: "musicxml",
      learning_source_checksum: "a".repeat(64),
      learning_mapping: { P1: "piano" },
      learning_fingering: { guitar: { string: 2, fret: 3 } },
      duration_seconds: 261,
    });
  });

  it("refuses anonymous or publishable credentials for production writes", async () => {
    expect(isTrustedServerCredential("sb_publishable_test-only")).toBe(false);
    expect(isTrustedServerCredential("sb_secret_test-only")).toBe(true);
    const report = await runImport(await makePackage(), false, { environment: {} });
    expect(report.valid).toBe(false);
    expect(report.songId).toBeUndefined();
    expect(report.issues.join(" ")).toContain("trusted local");
  });

  it("reports partial state without automatically rolling it back", () => {
    const report: ImportReport = {
      dryRun: false,
      slug: "partial-song",
      valid: true,
      partial: false,
      songId: "song-id",
      uploaded: [{ bucket: "audio", path: "partial-song/audio.mp3", filename: "audio.mp3" }],
      reused: [],
      skipped: [],
      issues: [],
      instrumentParts: [],
    };
    expect(markImportFailure(report, new Error("database write stopped"))).toMatchObject({
      valid: false,
      partial: true,
      songId: "song-id",
      issues: ["database write stopped"],
    });
    expect(report.uploaded).toHaveLength(1);
  });

  it("detects duplicate checksums", () => {
    expect(isDuplicateChecksum("abc", ["def", "abc"])).toBe(true);
    expect(isDuplicateChecksum("new", ["def", "abc"])).toBe(false);
  });

  it("rejects unknown files while accepting the instrument-parts directory", async () => {
    const folder = await makePackage();
    await writeFile(path.join(folder, "unknown.bin"), "bad");
    const result = await inspectSongPackage(folder);
    expect(result.issues).toContain("Unexpected file: unknown.bin");
  });
});
