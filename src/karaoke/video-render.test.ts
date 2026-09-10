import { describe, expect, it } from "vitest";
import type { KaraokeRenderManifest } from "./contracts";
import { assLayout, createAss, createPresetAss, karaokePreset, karaokePresets, karaokePresetSlug } from "./exports";
import { alignLyricsToNotes } from "./lyrics-alignment";
import { createLearningNotes } from "./vocal-midi";
import { buildKaraokeFfmpegArgs, escapeFilterPath } from "./video-render";

const alignment = alignLyricsToNotes("one two", createLearningNotes([
  { id: "a", midi: 60, startSeconds: 0, durationSeconds: .4, velocity: .8, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: 0 },
  { id: "b", midi: 62, startSeconds: .5, durationSeconds: .4, velocity: .8, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: .5 },
])).alignment;

const render = (overrides: Partial<KaraokeRenderManifest> = {}): KaraokeRenderManifest => ({
  version: 1, preset: "youtube-16:9", ...karaokePreset("youtube-16:9"),
  background: { kind: "image", source: "/tmp/cover.jpg" },
  audio: { kind: "instrumental", source: "/tmp/instrumental.mp3" },
  subtitles: { source: "/tmp/exports/lyrics.ass", format: "ass" },
  durationSeconds: .9, ...overrides,
});

describe("karaoke subtitle layout", () => {
  it("keeps the original 1920x1080 style header byte-identical", () => {
    const ass = createAss(alignment, []);
    expect(ass).toContain("PlayResX: 1920\nPlayResY: 1080");
    expect(ass).toContain("Style: Karaoke,Arial,64,&H00FFFFFF,&H0000B8FF,&H00101010,&H70000000,-1,0,0,0,100,100,0,0,1,3,1,2,120,120,110,1");
    expect(ass).toContain("Style: Chord,Arial,34,&H0000B8FF,&H0000B8FF,&H00101010,&H50000000,-1,0,0,0,100,100,0,0,1,2,0,8,120,120,190,1");
  });

  it("matches subtitle resolution to every preset frame", () => {
    for (const preset of karaokePresets) {
      const { width, height } = karaokePreset(preset);
      expect(createPresetAss(alignment, [], preset)).toContain(`PlayResX: ${width}\nPlayResY: ${height}`);
    }
  });

  it("derives margins from the preset safe margin", () => {
    expect(assLayout(1080, 1920, 108)).toEqual({ karaokeFontSize: 64, chordFontSize: 34, marginLR: 135, karaokeMarginV: 122, chordMarginV: 202 });
    expect(assLayout(1080, 1080, 86)).toEqual({ karaokeFontSize: 64, chordFontSize: 34, marginLR: 108, karaokeMarginV: 100, chordMarginV: 180 });
  });

  it("keeps type size proportional to the narrow edge", () => {
    expect(assLayout(1280, 720, 64).karaokeFontSize).toBe(43);
  });

  it("names each layout distinctly and leaves 16:9 unsuffixed", () => {
    expect(karaokePresets.map(karaokePresetSlug)).toEqual(["16x9", "9x16", "1x1"]);
  });

  it("carries karaoke timing into every preset", () => {
    for (const preset of karaokePresets) expect(createPresetAss(alignment, [], preset)).toContain("{\\k");
  });
});

describe("karaoke FFmpeg arguments", () => {
  it("scales and crops a cover image, burns in the subtitles and maps both streams", () => {
    const args = buildKaraokeFfmpegArgs(render(), { outputFile: "/tmp/out.mp4" });
    expect(args.slice(0, 6)).toEqual(["-y", "-loglevel", "error", "-loop", "1", "-i"]);
    expect(args).toContain("/tmp/cover.jpg");
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(filter).toContain("ass='/tmp/exports/lyrics.ass'");
    expect(args).toContain("[v]");
    expect(args).toContain("1:a");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("renders a dark gradient without any cover", () => {
    const args = buildKaraokeFfmpegArgs(render({ background: { kind: "dark-gradient", source: null }, ...karaokePreset("shorts-9:16"), preset: "shorts-9:16" }), { outputFile: "/tmp/vertical.mp4" });
    expect(args).toContain("lavfi");
    expect(args.join(" ")).toContain("gradients=s=1080x1920");
    expect(args.join(" ")).toContain("speed=0.00001:seed=1");
    expect(args.join(" ")).not.toContain("cover.jpg");
  });

  it("keeps the whole cover visible behind a blurred fill", () => {
    const args = buildKaraokeFfmpegArgs(render({ background: { kind: "cover-blur", source: "/tmp/cover.jpg" }, ...karaokePreset("shorts-9:16"), preset: "shorts-9:16" }), { outputFile: "/tmp/blur.mp4" });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("split=2");
    expect(filter).toContain("gblur=sigma=");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("refuses a cover background with no source", () => {
    expect(() => buildKaraokeFfmpegArgs(render({ background: { kind: "image", source: null } }), { outputFile: "/tmp/out.mp4" })).toThrow(/background.source/);
  });

  it("refuses a background kind it cannot render offline", () => {
    expect(() => buildKaraokeFfmpegArgs(render({ background: { kind: "video", source: "/tmp/clip.mp4" } }), { outputFile: "/tmp/out.mp4" })).toThrow(/not implemented/);
  });

  it("refuses a path FFmpeg cannot quote instead of emitting a broken filtergraph", () => {
    expect(() => escapeFilterPath("/tmp/zura's songs/lyrics.ass")).toThrow(/apostrophe/);
  });

  it("escapes a Windows drive path for the subtitle filter", () => {
    expect(escapeFilterPath("C:\\karaoke\\song\\lyrics.ass")).toBe("C\\:/karaoke/song/lyrics.ass");
  });

  it("uses an override audio track for a guide mix", () => {
    const args = buildKaraokeFfmpegArgs(render({ audio: { kind: "instrumental-guide", source: "/tmp/instrumental.mp3", guide: "piano" } }), { outputFile: "/tmp/guide.mp4", audioFile: "/tmp/instrumental-guide.mp3" });
    expect(args).toContain("/tmp/instrumental-guide.mp3");
    expect(args).not.toContain("/tmp/instrumental.mp3");
  });

  it("trims a short review clip when asked", () => {
    const args = buildKaraokeFfmpegArgs(render(), { outputFile: "/tmp/clip.mp4", durationSeconds: 6 });
    expect(args[args.indexOf("-t") + 1]).toBe("6.000");
  });

  it("writes web-ready MP4 output", () => {
    const args = buildKaraokeFfmpegArgs(render(), { outputFile: "/tmp/out.mp4" });
    expect(args).toContain("+faststart");
    expect(args).toContain("yuv420p");
    expect(args).toContain("-shortest");
  });
});
