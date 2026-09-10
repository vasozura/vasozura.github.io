import { describe, expect, it } from "vitest";
import { karaokeContentType, manifestForUpload, planKaraokeUpload, publicManifestUrl } from "../../scripts/publish-karaoke-artifacts";
import type { KaraokeArtifactManifest } from "./contracts";
import { createBasicLyricsAlignment } from "./presentation";
import { canonicalSecondsFor, resolveTimeline, type TimelineInput } from "./timeline";

const manifest = (overrides: Partial<KaraokeArtifactManifest> = {}): KaraokeArtifactManifest => ({
  version: 1, songId: "song-1", slug: "ra-mogdis-kalav", generatedAt: "2026-09-10T00:00:00.000Z",
  sourceAudioSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  melodySource: "MP3 Vocal Extraction", sourceConfidence: "review",
  audio: { originalUrl: null, instrumentalUrl: "./instrumental.mp3", vocalUrl: "./vocal.mp3" },
  originalNotes: [], continuousNotes: [], alignment: createBasicLyricsAlignment("erti\nori", 8), chords: [],
  diagnostics: { noteCount: 0, pitchMin: null, pitchMax: null, medianNoteDurationMs: 0, shortNoteRejectionCount: 0, octaveCorrectionCount: 0, longestSilenceMs: 0, pitchConfidence: 0, monophonyRatio: 1, status: "review" },
  exports: { lrc: "./exports/lyrics.lrc", ass: "./exports/lyrics.ass", learningMidi: "./exports/learning-melody.mid", mp4: "./exports/karaoke-16x9.mp4" },
  ...overrides,
});

describe("karaoke storage delivery plan", () => {
  it("prefixes every object with the slug and the canonical audio checksum", () => {
    const plan = planKaraokeUpload(manifest());
    expect(plan.prefix).toBe("abcdef012345");
    expect(plan.manifestObjectPath).toBe("ra-mogdis-kalav/abcdef012345/manifest.json");
    expect(plan.items.map((item) => item.objectPath)).toContain("ra-mogdis-kalav/abcdef012345/exports/lyrics.lrc");
  });

  it("keeps rendered video out of a normal publish and opts it in explicitly", () => {
    expect(planKaraokeUpload(manifest()).items.some((item) => item.objectPath.endsWith(".mp4"))).toBe(false);
    expect(planKaraokeUpload(manifest()).skipped.map((entry) => entry.exportKey)).toContain("mp4");
    expect(planKaraokeUpload(manifest(), { includeVideo: true }).items.some((item) => item.objectPath.endsWith(".mp4"))).toBe(true);
  });

  it("uploads the instrumental so the browser can offer more than the original audio", () => {
    expect(planKaraokeUpload(manifest()).items.some((item) => item.objectPath.endsWith("/instrumental.mp3"))).toBe(true);
    expect(planKaraokeUpload(manifest({ audio: { originalUrl: null, instrumentalUrl: null, vocalUrl: null } })).items.some((item) => item.objectPath.endsWith(".mp3"))).toBe(false);
  });

  it("refuses an export path that would escape the prepared directory", () => {
    const plan = planKaraokeUpload(manifest({ exports: { lrc: "../../etc/passwd" } }));
    expect(plan.items).toHaveLength(1); // only the instrumental
    expect(plan.skipped[0].reason).toContain("escapes");
  });

  it("needs a slug and a checksum before it will plan anything", () => {
    expect(() => planKaraokeUpload(manifest({ slug: "" }))).toThrow(/slug/);
    expect(() => planKaraokeUpload(manifest({ sourceAudioSha256: "" }))).toThrow(/checksum/);
  });

  it("stores a manifest that only links artifacts the publish actually uploaded", () => {
    const source = manifest({ renders: [{ preset: "youtube-16:9", width: 1920, height: 1080, background: "cover-blur", audio: "instrumental", guide: null, exportKey: "mp4", file: "./exports/karaoke-16x9.mp4" }] });
    const stored = manifestForUpload(source, planKaraokeUpload(source));
    expect(stored.exports.mp4).toBeUndefined();
    expect(stored.exports.lrc).toBe("./exports/lyrics.lrc");
    expect(stored.renders).toHaveLength(0);
    // The authoritative lyric text is never touched by delivery.
    expect(stored.alignment.authoritativeText).toBe(source.alignment.authoritativeText);
  });

  it("builds an unsigned public URL that relative export paths resolve against", () => {
    const url = publicManifestUrl("https://project.supabase.co/", "ra-mogdis-kalav/abcdef012345/manifest.json");
    expect(url).toBe("https://project.supabase.co/storage/v1/object/public/karaoke/ra-mogdis-kalav/abcdef012345/manifest.json");
    expect(new URL("./exports/lyrics.lrc", url).href).toBe("https://project.supabase.co/storage/v1/object/public/karaoke/ra-mogdis-kalav/abcdef012345/exports/lyrics.lrc");
  });

  it("labels each artifact with a content type Storage accepts", () => {
    expect(karaokeContentType("manifest.json")).toBe("application/json");
    expect(karaokeContentType("learning-melody.mid")).toBe("audio/midi");
    expect(karaokeContentType("lyrics.ass")).toBe("text/plain");
    expect(karaokeContentType("karaoke-16x9.mp4")).toBe("video/mp4");
    expect(karaokeContentType("guide.unknown")).toBe("application/octet-stream");
  });
});

describe("basic karaoke without any vocal extraction", () => {
  const basic = (): TimelineInput => ({ alignment: createBasicLyricsAlignment("mze da mta\nsheni guli chemtan aris", 12), originalNotes: [], continuousNotes: [], chords: [] });

  it("gives every line and word a timing from the lyrics alone", () => {
    const input = basic();
    expect(input.alignment.lines).toHaveLength(2);
    expect(input.alignment.lines[0].startSeconds).toBe(0);
    for (const line of input.alignment.lines) {
      expect(line.endSeconds).toBeGreaterThan(line.startSeconds);
      for (const word of line.words) expect(word.endSeconds).toBeGreaterThan(word.startSeconds);
    }
  });

  it("highlights a line and a word during playback with no melody present", () => {
    const input = basic();
    const word = input.alignment.lines[0].words[1];
    const position = resolveTimeline(input, (word.startSeconds + word.endSeconds) / 2);
    expect(position.line?.id).toBe(input.alignment.lines[0].id);
    expect(position.word?.id).toBe(word.id);
    expect(position.note).toBeNull();
    expect(position.learningId).toBeNull();
  });

  it("still seeks from a clicked lyric", () => {
    const input = basic();
    const word = input.alignment.lines[1].words[0];
    const seconds = canonicalSecondsFor(input, { type: "word", id: word.id });
    expect(seconds).toBe(word.startSeconds);
    expect(resolveTimeline(input, seconds! + .01).word?.id).toBe(word.id);
  });

  it("marks the alignment for review rather than claiming prepared timing", () => {
    expect(basic().alignment.confidence).not.toBe("verified");
  });

  it("reports no chords instead of inventing them", () => {
    expect(resolveTimeline(basic(), 3).chords).toEqual([]);
  });
});
