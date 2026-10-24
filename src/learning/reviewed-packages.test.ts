import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { learningSongIdentity, validateLearningArtifactIdentity } from "./artifact-identity";
import type { LearningArtifactManifest } from "./melody-artifacts";

const slugs = ["suno-0d116a84", "suno-1829ca46", "suno-2017ae41", "suno-304f1b29", "suno-4848401c", "suno-4fdae2b6", "suno-af9a4bab", "suno-b1c35a84", "suno-f59d2437", "suno-fdf581a0"];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("reviewed canonical melody packages", () => {
  it.each(slugs)("accepts the active identity and exact static MIDI hashes for %s", async (slug) => {
    const root = path.resolve("public/karaoke", slug);
    const manifest = JSON.parse(await readFile(path.join(root, "learning-artifacts.json"), "utf8")) as LearningArtifactManifest;
    expect(validateLearningArtifactIdentity(learningSongIdentity(slug), manifest.song)).toEqual({ accepted: true });
    for (const instrument of ["piano", "guitar", "accordion"] as const) {
      const resource = manifest.instruments[instrument].melody;
      expect(resource.available).toBe(true);
      expect(sha256(await readFile(path.join(root, resource.url!)))).toBe(resource.sha256);
      expect(manifest.instruments[instrument].fullSong.available).toBe(false);
    }
  });
});
