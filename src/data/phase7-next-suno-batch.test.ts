import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateSunoProvenance, type SunoPackageProvenance } from "../../scripts/suno-provenance";

const recordsUrl = new URL("../../docs/phase7-next-suno-records.json", import.meta.url);

interface BatchRecord {
  source_index: number;
  slug: string;
  youtube_url: string;
  canonical: SunoPackageProvenance["canonical"];
  alternates: SunoPackageProvenance["alternates"];
}

interface BatchData {
  schema: string;
  batch_name: string;
  owner_confirmation: SunoPackageProvenance["owner_confirmation"];
  records: BatchRecord[];
}

async function data(): Promise<BatchData> {
  return JSON.parse(await readFile(recordsUrl, "utf8")) as BatchData;
}

describe("next Suno catalog batch", () => {
  it("contains 20 unique approved canonical records and excludes the imported five", async () => {
    const batch = await data();
    const imported = new Set([51, 52, 53, 55, 144]);
    const indices = batch.records.map((record) => record.source_index);
    const canonicalIds = batch.records.map((record) => record.canonical.generation_id);
    const audioHashes = batch.records.map((record) => record.canonical.local_media?.sha256);

    expect(batch).toMatchObject({ schema: "zura-suno-preparation/v1", batch_name: "phase7-next-20" });
    expect(batch.records).toHaveLength(20);
    expect(new Set(indices).size).toBe(20);
    expect(indices.some((index) => imported.has(index))).toBe(false);
    expect(new Set(canonicalIds).size).toBe(20);
    expect(new Set(audioHashes).size).toBe(20);
    expect(batch.records.filter((record) => record.canonical.local_media?.confidence === "exact")).toHaveLength(8);
    expect(batch.records.filter((record) => record.canonical.local_media?.confidence === "high")).toHaveLength(12);
  });

  it("locks the owner-verified Suno and YouTube identifiers", async () => {
    const batch = await data();
    expect(batch.records.map((record) => [
      record.source_index,
      record.canonical.generation_id,
      new URL(record.youtube_url).searchParams.get("v"),
    ])).toEqual([
      [33, "2017ae41-bc61-481b-b471-f596623fb3e0", "u_LyCgSf7C0"],
      [37, "af9a4bab-9b42-4b12-bac0-30623387eae0", "Xejm5Q34mt8"],
      [38, "304f1b29-075b-40d1-99a9-daf73aa33cbd", "LLJICGv_E-Q"],
      [44, "fdf581a0-889c-4d1e-a39d-936ac1e22b97", "aQxVhaZCA0g"],
      [48, "4848401c-51fb-4680-acea-1c2e4b566b45", "UxHiJ9bcdY0"],
      [49, "f59d2437-d9cf-40ce-9d51-80de18a46d71", "WwRJxy7LkfE"],
      [50, "4fdae2b6-e5b9-4233-963d-5bba1d0c5742", "xgY3wmQeRvc"],
      [57, "0d116a84-60f9-40a8-9e92-3fb7ec695076", "euYCoK0jjfE"],
      [59, "77e62e25-d1aa-4b31-9557-ecc7bc5d8625", "KH2EZr9-qYo"],
      [61, "1829ca46-999c-4702-ba35-6a8b26567886", "mv9rJFdWOHo"],
      [75, "cdf81aba-c26c-4d0a-80e8-29f0e7d5415b", "ZhwZ74QR520"],
      [197, "cff0def8-3981-4076-910b-e92ec12dca9e", "k_q9rntARDk"],
      [104, "5e8c4dfc-ec1c-44f5-ab43-0b15eb5fe561", "mVRYcFWwZ_I"],
      [62, "83535f74-c946-4b80-9206-7ef42420e4fb", "Hjn62A3HSqA"],
      [96, "1b43514d-76e3-474c-8532-7364474e276c", "mw970tytwgs"],
      [148, "868a58e9-16ff-4194-a974-4c8a4f47a75b", "prpNrWD3AgQ"],
      [152, "eef7eb6f-bbf7-40d6-8a53-c54e2985c10a", "eFkEuHWer24"],
      [54, "f0b9a135-5cfa-4f28-ac16-3c39b90e8d34", "7ZtK_1MOShQ"],
      [150, "4cd7f85c-5f2c-48a4-bca1-a1bf98566d76", "peyvO-ArTcA"],
      [19, "b1c35a84-bf24-4441-a7b5-c497fc0999cd", "A0ZO3hjxOB8"],
    ]);
  });

  it("keeps alternates in provenance and only stable public URLs", async () => {
    const batch = await data();
    const canonicalIds = new Set(batch.records.map((record) => record.canonical.generation_id));
    const allGenerationIds = new Set<string>();

    for (const record of batch.records) {
      const provenance: SunoPackageProvenance = {
        schema_version: "zura-suno-provenance/v1",
        source_index: record.source_index,
        canonical: record.canonical,
        alternates: record.alternates,
        owner_confirmation: batch.owner_confirmation,
        readiness: { status: "approved", blockers: [] },
      };
      expect(validateSunoProvenance(provenance).issues).toEqual([]);
      expect(record.youtube_url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      for (const generation of [record.canonical, ...record.alternates]) {
        expect(allGenerationIds.has(generation.generation_id)).toBe(false);
        allGenerationIds.add(generation.generation_id);
      }
      expect(record.alternates.some((alternate) => canonicalIds.has(alternate.generation_id))).toBe(false);
    }

    expect(JSON.stringify(batch)).not.toMatch(/audio_url|download_url|signed_url|authorization|bearer|sbp_/i);
  });
});
