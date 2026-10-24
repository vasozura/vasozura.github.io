import { describe, expect, it } from "vitest";
import type { LearningArtifactManifest, LearningArtifactResource } from "./melody-artifacts";
import { discoverOriginalSource, resolveLearningSourceAvailability } from "./static-source-controls";

const unavailable: LearningArtifactResource = { available: false, url: null, sha256: null, strategy: "unavailable", provenance: "full-song-arrangement" };
const resource = (url: string, provenance: LearningArtifactResource["provenance"] = "instrument-adapted-melody"): LearningArtifactResource => ({ available: true, url, sha256: "sha", strategy: "static-midi", provenance });

function packageWith(options: { melody?: boolean; fullSong?: boolean } = {}): LearningArtifactManifest {
  const melody = options.melody === false ? unavailable : resource("midi/piano-melody.mid");
  const fullSong = options.fullSong ? resource("midi/piano-full-song.mid", "full-song-arrangement") : unavailable;
  return {
    schemaVersion: "zura-learning-artifacts/v1",
    song: { slug: "suno-2017ae41", generationId: "2017ae41-bc61-481b-b471-f596623fb3e0", canonicalAudioSha256: "fc1a373c6838c4e718185e4b88d9e2102ac6bcc75553888c25b19f4280086536" },
    instruments: {
      piano: { original: unavailable, melody, fullSong },
      guitar: { original: unavailable, melody: options.melody === false ? unavailable : resource("midi/guitar-melody.mid"), fullSong: options.fullSong ? resource("midi/guitar-full-song.mid", "full-song-arrangement") : unavailable },
      accordion: { original: unavailable, melody: options.melody === false ? unavailable : resource("midi/accordion-melody.mid"), fullSong: options.fullSong ? resource("midi/accordion-full-song.mid", "full-song-arrangement") : unavailable },
    },
  };
}

describe("static-first Learning source availability", () => {
  it.each([
    ["Original + Melody starts Original", true, packageWith(), "piano", ["original", "melody"], "original"],
    ["Melody-only starts Melody", false, packageWith(), "piano", ["melody"], "melody"],
    ["Original-only stays Original", true, packageWith({ melody: false }), "piano", ["original"], "original"],
    ["no static package preserves Original", true, null, "piano", ["original"], "original"],
    ["static 404 is represented independently from Original", true, null, "guitar", ["original"], "original"],
    ["static 404 without Original is unavailable", false, null, "piano", [], null],
    ["invalid static schema is rejected before availability", true, null, "piano", ["original"], "original"],
    ["generation mismatch is rejected before availability", true, null, "piano", ["original"], "original"],
    ["audio mismatch without Original fabricates nothing", false, null, "piano", [], null],
    ["valid static survives unavailable API", false, packageWith(), "piano", ["melody"], "melody"],
    ["valid static survives invalid API", false, packageWith(), "guitar", ["melody"], "melody"],
    ["data MIDI Original combines with Melody", true, packageWith(), "guitar", ["original", "melody"], "original"],
    ["absent Full Song is not exposed", false, packageWith(), "accordion", ["melody"], "melody"],
    ["Full Song is independent", false, packageWith({ melody: false, fullSong: true }), "piano", ["fullSong"], "fullSong"],
    ["Source 33 static-only regression", false, packageWith(), "piano", ["melody"], "melody"],
    ["promoted guitar Melody-only fixture", false, packageWith(), "guitar", ["melody"], "melody"],
    ["Original remains a switch target beside Melody", true, packageWith(), "accordion", ["original", "melody"], "original"],
    ["Melody-only startup has one truthful mode", false, packageWith(), "accordion", ["melody"], "melody"],
    ["Full Song does not outrank Melody", false, packageWith({ fullSong: true }), "piano", ["melody", "fullSong"], "melody"],
    ["Original outranks independent Melody and Full Song", true, packageWith({ fullSong: true }), "piano", ["original", "melody", "fullSong"], "original"],
  ] as const)("%s", (_name, hasOriginal, manifest, instrument, available, initial) => {
    expect(resolveLearningSourceAvailability(hasOriginal, manifest, instrument)).toEqual({ available, initial });
  });

  it("keeps API Original authoritative when it loads", async () => {
    await expect(discoverOriginalSource({ loadApi: async () => "api", loadMidi: async () => "midi", staticAvailable: true, isApiUnavailable: () => false })).resolves.toEqual({ source: "api", local: false });
  });

  it("uses data MIDI as Original when the API fails", async () => {
    await expect(discoverOriginalSource({ loadApi: async () => { throw new Error("missing"); }, loadMidi: async () => "midi", staticAvailable: true, isApiUnavailable: () => true })).resolves.toEqual({ source: "midi", local: true });
  });

  it("allows verified static Melody to survive an invalid API Original", async () => {
    await expect(discoverOriginalSource({ loadApi: async () => { throw new Error("invalid"); }, staticAvailable: true, isApiUnavailable: () => false })).resolves.toEqual({ source: null, local: false });
  });

  it("does not hide an invalid API error when no independent source exists", async () => {
    await expect(discoverOriginalSource({ loadApi: async () => { throw new Error("invalid"); }, staticAvailable: false, isApiUnavailable: () => false })).rejects.toThrow("invalid");
  });
});
