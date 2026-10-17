import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import type { LearningArtifactManifest, LearningArtifactMode } from "./melody-artifacts";
import { resolveLearningArtifact } from "./melody-artifacts";

const root = path.resolve("public/karaoke/suno-2017ae41");
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("Source 33 static Learning package", () => {
  it("contains identity-bound, checksum-valid Melody assets and no fabricated Full Song", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "learning-artifacts.json"), "utf8")) as LearningArtifactManifest & { midiIdentity: { durationSeconds: number; noteCount: number; tempoMapSha256: string }; artifacts: Array<{ filename: string; sha256: string; noteCount: number; durationSeconds: number }> };
    expect(manifest.song).toEqual({ sourceIndex: 33, slug: "suno-2017ae41", generationId: "2017ae41-bc61-481b-b471-f596623fb3e0", canonicalAudioSha256: "fc1a373c6838c4e718185e4b88d9e2102ac6bcc75553888c25b19f4280086536" });
    for (const instrument of ["piano", "guitar", "accordion"] as const) {
      const resolved = resolveLearningArtifact(manifest, instrument, "melody");
      expect(resolved.available).toBe(true);
      const bytes = await readFile(path.join(root, resolved.url!));
      const entry = manifest.artifacts.find(({ filename }) => resolved.url!.endsWith(filename));
      expect(entry).toBeDefined();
      expect(sha256(bytes)).toBe(entry!.sha256);
      const midi = new Midi(bytes);
      expect(midi.tracks.flatMap((track) => track.notes)).toHaveLength(entry!.noteCount);
      expect(midi.duration).toBeCloseTo(entry!.durationSeconds, 6);
      expect(resolveLearningArtifact(manifest, instrument, "fullSong" as LearningArtifactMode)).toMatchObject({ available: false, url: null });
    }
  });
});
