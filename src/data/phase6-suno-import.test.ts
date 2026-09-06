import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBatch } from "../../scripts/import-batch";
import { runImport } from "../../scripts/import-song";
import { validateSunoProvenance, type SunoPackageProvenance } from "../../scripts/suno-provenance";

const recordsUrl = new URL("../../docs/phase6-suno-records.json", import.meta.url);
const folders: string[] = [];

interface Phase6Record {
  source_index: number;
  slug: string;
  language: string;
  youtube_url: string;
  credits: { composer: string; lyricist: string; translator: string | null };
  canonical: SunoPackageProvenance["canonical"];
  alternates: SunoPackageProvenance["alternates"];
}

interface Phase6Data {
  schema: string;
  workbook_sha256: string;
  project_metadata: { artist_name: string; legal_owner: string; rights_holder: string; archive_owner: string };
  owner_confirmation: SunoPackageProvenance["owner_confirmation"];
  records: Phase6Record[];
}

async function records(): Promise<Phase6Data> {
  return JSON.parse(await readFile(recordsUrl, "utf8")) as Phase6Data;
}

function provenance(record: Phase6Record, confirmations: SunoPackageProvenance["owner_confirmation"]): SunoPackageProvenance {
  return {
    schema_version: "zura-suno-provenance/v1",
    source_index: record.source_index,
    canonical: record.canonical,
    alternates: record.alternates,
    owner_confirmation: confirmations,
    readiness: { status: "owner-review-required", blockers: ["owner approval"] },
  };
}

async function syntheticPackage(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "zura-phase6-"));
  folders.push(folder);
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.from("canonical local audio")]);
  const checksum = createHash("sha256").update(audio).digest("hex");
  const value: SunoPackageProvenance = {
    schema_version: "zura-suno-provenance/v1",
    source_index: 51,
    canonical: {
      generation_id: "80ccf1f1-a8d3-4b14-9393-5fdda4f9392c",
      url: "https://suno.com/song/80ccf1f1-a8d3-4b14-9393-5fdda4f9392c",
      title: "Dream one up-Based on the Poem by Berdia Beriashvili",
      role: "canonical",
      source_created_at_text: "July 10, 2026 at 6:40 PM",
      duration_seconds: 238,
      style_prompt: "roots reggae",
      local_media: { filename: "verified.mp3", sha256: checksum, duration_seconds: 238.88, confidence: "exact" },
      matching_evidence: ["Exact identifier, title and duration evidence."],
    },
    alternates: [],
    owner_confirmation: { composer: "pending", lyricist: "pending", translator: "pending", recording_rights: "pending", publication_rights: "pending", final_mp3: "pending", learning_mode: "pending" },
    readiness: { status: "owner-review-required", blockers: ["owner approval"] },
  };
  const metadata = {
    slug: "suno-80ccf1f1",
    status: "draft",
    title_ka: value.canonical.title,
    title_en: value.canonical.title,
    composer: null,
    lyricist: null,
    translator: null,
    language: "en",
    suno_url: value.canonical.url,
    youtube_url: "https://www.youtube.com/watch?v=IJXtjZqytiw",
    duration_seconds: 238.88,
    learning_enabled: false,
  };
  await Promise.all([
    writeFile(path.join(folder, "audio.mp3"), audio),
    writeFile(path.join(folder, "metadata.json"), JSON.stringify(metadata)),
    writeFile(path.join(folder, "suno-provenance.json"), JSON.stringify(value)),
    writeFile(path.join(folder, "lyrics-en.txt"), "Source language lyrics\n"),
  ]);
  const names = ["audio.mp3", "metadata.json", "suno-provenance.json", "lyrics-en.txt"];
  const lines: string[] = [];
  for (const name of names) lines.push(`${createHash("sha256").update(await readFile(path.join(folder, name))).digest("hex")}  ${name}`);
  await writeFile(path.join(folder, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("Phase 6 Suno provenance", () => {
  it("preserves the five exact canonical IDs and verified YouTube mappings", async () => {
    const data = await records();
    expect(data.records.map((entry) => entry.canonical.generation_id)).toEqual([
      "80ccf1f1-a8d3-4b14-9393-5fdda4f9392c",
      "e925fe09-ed36-4092-81b6-ef4141d43d66",
      "ddff59b0-336a-44d5-b18b-2f301b83850b",
      "6b85f175-2289-4eac-88fb-5483153bd01b",
      "4b855a49-af5a-4b3a-88d9-92a4ab4563bb",
    ]);
    expect(data.records.map((entry) => new URL(entry.youtube_url).searchParams.get("v"))).toEqual([
      "IJXtjZqytiw", "QWS6ORn0i8o", "gHrUvv8oUac", "6fVZr9eKG98", "JB83Fdj-XUk",
    ]);
  });

  it("keeps canonical and alternate generations separate", async () => {
    const data = await records();
    for (const record of data.records) {
      const validated = validateSunoProvenance(provenance(record, data.owner_confirmation));
      expect(validated.issues).toEqual([]);
      expect(record.canonical.role).toBe("canonical");
      expect(record.alternates.every((entry) => entry.role === "alternate")).toBe(true);
      expect(record.alternates.map((entry) => entry.generation_id)).not.toContain(record.canonical.generation_id);
    }
  });

  it("preserves local SHA-256 and measured duration evidence", async () => {
    const data = await records();
    expect(data.records.map((entry) => entry.canonical.local_media?.sha256)).toEqual([
      "fb5de1888496079a5ade7b69cb967753209428e8330da60e666377d1aac50b0b",
      "e9f5a899600156a5d5738516621c003aecd8b3debde845b6bfad52fe1fc6dd02",
      "1d5b42d62a51aa3e4bb1333f54cade524b5c65fbe90fa9aa21c9b54652097201",
      "c30a13a460650671fc57d9756b84ff8aa142836b8658acc5a3eb9fd16f51718f",
      "ba0af53f16bc8f0575a18ec4aaa43b428c16d1db95b98a813d181628a11ed75d",
    ]);
    expect(data.records.map((entry) => entry.canonical.local_media?.duration_seconds)).toEqual([238.88, 253.8, 234.6, 257.6, 252.04]);
    expect(data.records.every((entry) => entry.canonical.local_media?.filename.endsWith(".mp3"))).toBe(true);
  });

  it("applies confirmed project defaults without replacing verified poet attribution", async () => {
    const data = await records();
    expect(data.owner_confirmation).toMatchObject({
      composer: "confirmed",
      lyricist: "confirmed",
      translator: "confirmed",
      recording_rights: "confirmed",
      publication_rights: "confirmed",
      final_mp3: "confirmed",
      learning_mode: "confirmed",
    });
    expect(data.records.every((record) => record.credits.composer === "Zura Alexandria")).toBe(true);
    expect(data.project_metadata).toEqual({
      artist_name: "Zura Alexandria",
      legal_owner: "Vasil Zurashvili",
      rights_holder: "Vasil Zurashvili / Zura Alexandria",
      archive_owner: "Vasil Zurashvili / Zura Alexandria",
    });
    expect(data.records.filter((record) => record.credits.lyricist === "Berdia Beriashvili").map((record) => record.source_index)).toEqual([51, 52, 53, 55]);
    expect(data.records.find((record) => record.source_index === 144)?.credits).toEqual({
      composer: "Zura Alexandria",
      lyricist: "Zura Alexandria",
      translator: null,
    });
  });

  it("stores only stable public source URLs and no protected Suno media URL", async () => {
    const data = await records();
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/audio_url|download_url|signed_url|cdn|token|authorization/i);
    for (const record of data.records) {
      expect(record.canonical.url).toBe(`https://suno.com/song/${record.canonical.generation_id}`);
      expect(record.alternates.every((entry) => entry.url === `https://suno.com/song/${entry.generation_id}`)).toBe(true);
      expect(record.canonical.local_media?.filename).not.toMatch(/[\\/:]/);
    }
  });

  it("locks index 55 canonical media and keeps the 278.440-second file alternate", async () => {
    const record = (await records()).records.find((entry) => entry.source_index === 55)!;
    expect(record.canonical).toMatchObject({
      generation_id: "6b85f175-2289-4eac-88fb-5483153bd01b",
      local_media: { duration_seconds: 257.6, sha256: "c30a13a460650671fc57d9756b84ff8aa142836b8658acc5a3eb9fd16f51718f" },
    });
    expect(record.alternates.find((entry) => entry.generation_id === "81dc6c14-63c3-4104-a806-3efa99f38601")).toMatchObject({
      role: "alternate",
      local_media: { filename: expect.stringMatching(/_1\.mp3$/), duration_seconds: 278.44, sha256: "5ca126235cdc8ed792fc1c12a809551c08c6f8e55ac2b29bf498b09201ba4932" },
    });
  });

  it("dry-runs a provenance package without touching a supplied client", async () => {
    const trap = vi.fn(() => { throw new Error("dry-run attempted a network write"); });
    const client = new Proxy({}, { get: trap });
    const report = await runImport(await syntheticPackage(), true, { client: client as never });
    expect(report).toMatchObject({
      valid: true,
      dryRun: true,
      phase: "validation",
      uploaded: [],
      provenance: {
        canonicalGenerationId: "80ccf1f1-a8d3-4b14-9393-5fdda4f9392c",
        alternateCount: 0,
        generationIds: ["80ccf1f1-a8d3-4b14-9393-5fdda4f9392c"],
      },
    });
    expect(trap).not.toHaveBeenCalled();
  });

  it("rejects a mismatched canonical checksum and protected URL fields before writes", async () => {
    const folder = await syntheticPackage();
    const filename = path.join(folder, "suno-provenance.json");
    const value = JSON.parse(await readFile(filename, "utf8")) as Record<string, unknown> & { canonical: Record<string, unknown> };
    value.canonical.audio_url = "https://protected.example/audio?token=secret";
    value.canonical.local_media = { filename: "verified.mp3", sha256: "a".repeat(64), duration_seconds: 238.88, confidence: "exact" };
    await writeFile(filename, JSON.stringify(value));
    const report = await runImport(folder, true);
    expect(report.valid).toBe(false);
    expect(report.uploaded).toEqual([]);
    expect(report.issues.join(" ")).toMatch(/audio_url is not supported|SHA-256/);
  });

  it("rejects one Suno generation reused by different package slugs", async () => {
    const first = await syntheticPackage();
    const second = await syntheticPackage();
    const metadataFile = path.join(second, "metadata.json");
    const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as Record<string, unknown>;
    metadata.slug = "different-song";
    metadata.title_ka = "Different song";
    metadata.title_en = "Different song";
    await writeFile(metadataFile, JSON.stringify(metadata));
    const names = ["audio.mp3", "metadata.json", "suno-provenance.json", "lyrics-en.txt"];
    const lines: string[] = [];
    for (const name of names) lines.push(`${createHash("sha256").update(await readFile(path.join(second, name))).digest("hex")}  ${name}`);
    await writeFile(path.join(second, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);

    const manifestFolder = await mkdtemp(path.join(tmpdir(), "zura-phase6-batch-"));
    folders.push(manifestFolder);
    const manifest = path.join(manifestFolder, "batch.json");
    await writeFile(manifest, JSON.stringify({
      schema: "zura-song-batch/v1",
      packages: [
        { path: first, expectedSlug: "suno-80ccf1f1" },
        { path: second, expectedSlug: "different-song" },
      ],
    }));
    const report = await runBatch(manifest, true);
    expect(report.valid).toBe(false);
    expect(report.issues).toContain("Suno generation 80ccf1f1-a8d3-4b14-9393-5fdda4f9392c is duplicated across suno-80ccf1f1 and different-song.");
    expect(report.aggregate.uploaded).toBe(0);
  });
});
