import { describe, expect, it } from "vitest";
import type { Song } from "../types/song";
import { renderSongCard } from "./song-card";

const song: Song = { id: "one", slug: "leave-a-mark", title: { ka: "leave a mark", en: "leave a mark" }, displayCredit: { ka: "ZURA", en: "ZURA" }, composer: null, lyricistOrPoet: null, translator: null, language: "EN", description: null, lyrics: { ka: null, en: "Leave a mark" }, coverUrl: null, audioUrl: "https://example.com/song.mp3", midiUrl: null, musicXmlUrl: null, scorePdfUrl: null, sourceProjectUrl: null, sunoUrl: null, youtubeUrl: null, youtubeVideoId: null, durationSeconds: 180, bpm: null, musicalKey: null, timeSignature: null, difficulty: null, publicationStatus: "published", publicationDate: null };

describe("song card resources", () => {
  it("renders TXT as an accessible link to the song lyrics page", () => {
    const html = renderSongCard(song, 0, "ka");
    expect(html).toContain('href="#/song/leave-a-mark"');
    expect(html).toContain("ტექსტის გახსნა");
    expect(html).toContain(">TXT</a>");
  });
});
