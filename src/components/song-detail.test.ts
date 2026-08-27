import { describe, expect, it } from "vitest";
import { renderSongDetail } from "./song-detail";
import type { Song } from "../types/song";

const song: Song = { id: "1", slug: "one", title: { ka: "ერთი", en: "One" }, displayCredit: null, composer: null, lyricistOrPoet: null, translator: null, language: null, description: null, lyrics: null, coverUrl: null, audioUrl: null, midiUrl: null, musicXmlUrl: null, scorePdfUrl: null, sourceProjectUrl: null, sunoUrl: null, youtubeUrl: null, youtubeVideoId: null, durationSeconds: null, bpm: null, musicalKey: null, timeSignature: null, difficulty: null, publicationStatus: "published", publicationDate: null };

describe("song resource rendering", () => {
  it("hides unavailable controls", () => {
    const html = renderSongDetail(song, "en");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("interactive-score");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("No additional files");
  });

  it("renders only supplied resources", () => {
    const html = renderSongDetail({ ...song, audioUrl: "https://example.com/a.mp3", musicXmlUrl: "https://example.com/a.musicxml" }, "en");
    expect(html).toContain("<audio");
    expect(html).toContain("interactive-score");
    expect(html).not.toContain("PDF score");
  });
});
