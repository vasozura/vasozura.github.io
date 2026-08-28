import { describe, expect, it } from "vitest";
import { filterSongs } from "./catalog-filter";
import type { Song } from "../types/song";

const base: Song = { id: "1", slug: "one", title: { ka: "სიმღერა", en: "Song" }, displayCredit: { ka: "ავტორი", en: "Author" }, composer: null, lyricistOrPoet: { ka: "პოეტი", en: "Poet" }, translator: null, language: "ka", description: null, lyrics: { ka: "ტექსტი", en: null }, coverUrl: null, audioUrl: "https://example.com/a.mp3", midiUrl: null, musicXmlUrl: null, scorePdfUrl: null, sourceProjectUrl: null, sunoUrl: null, youtubeUrl: null, youtubeVideoId: null, durationSeconds: null, bpm: null, musicalKey: null, timeSignature: null, difficulty: "beginner", publicationStatus: "published", publicationDate: null };

describe("catalog filtering", () => {
  it("combines search, language, lyricist, difficulty and resource filters", () => {
    const result = filterSongs([base, { ...base, id: "2", slug: "two", title: { ka: "სხვა", en: "Other" }, audioUrl: null }], { query: "song", language: "ka", lyricist: "Poet", difficulty: "beginner", resource: "audio" });
    expect(result.map((song) => song.id)).toEqual(["1"]);
  });
});
