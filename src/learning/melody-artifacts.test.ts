import { describe, expect, it } from "vitest";
import { resolveLearningArtifact, type LearningArtifactManifest } from "./melody-artifacts";

const unavailable = { available: false, url: null, sha256: null, strategy: "unavailable" as const, provenance: "full-song-arrangement" as const };
const original = { available: true, url: null, sha256: null, strategy: "existing-learning-source" as const, provenance: "source-authored-midi" as const };
const manifest: LearningArtifactManifest = {
  schemaVersion: "zura-learning-artifacts/v1",
  song: { slug: "suno-2017ae41", generationId: "2017ae41-bc61-481b-b471-f596623fb3e0", canonicalAudioSha256: "fc1a373c6838c4e718185e4b88d9e2102ac6bcc75553888c25b19f4280086536" },
  instruments: {
    piano: { original, melody: { available: true, url: "midi/piano-melody.mid", sha256: "p", provenance: "instrument-adapted-melody" }, fullSong: unavailable },
    guitar: { original, melody: { available: true, url: "midi/guitar-melody.mid", sha256: "g", provenance: "instrument-adapted-melody" }, fullSong: unavailable },
    accordion: { original, melody: { available: true, url: "midi/accordion-melody.mid", sha256: "a", provenance: "instrument-adapted-melody" }, fullSong: unavailable },
  },
};

describe("Source 33 Learning artifact resolution", () => {
  it.each([
    ["piano", "midi/piano-melody.mid"],
    ["guitar", "midi/guitar-melody.mid"],
    ["accordion", "midi/accordion-melody.mid"],
  ] as const)("resolves the %s Melody without changing instrument identity", (instrument, url) => {
    expect(resolveLearningArtifact(manifest, instrument, "melody")).toEqual({ instrument, mode: "melody", available: true, url, reason: null, strategy: "static-midi" });
  });

  it("keeps Original, Melody, and Full Song distinct and reports missing layers", () => {
    expect(resolveLearningArtifact(manifest, "guitar", "original")).toMatchObject({ available: true, strategy: "existing-learning-source" });
    expect(resolveLearningArtifact(manifest, "guitar", "melody").available).toBe(true);
    expect(resolveLearningArtifact(manifest, "guitar", "fullSong")).toMatchObject({ available: false, url: null });
  });

  it("rejects path traversal instead of loading a fallback", () => {
    const unsafe = structuredClone(manifest);
    unsafe.instruments.piano.melody.url = "../other-song/melody.mid";
    expect(resolveLearningArtifact(unsafe, "piano", "melody")).toMatchObject({ available: false, url: null });
  });
});
