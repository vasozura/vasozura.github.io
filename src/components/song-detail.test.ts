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
    expect(html).not.toContain("No additional files");
    expect(html).toContain("Resource availability");
    expect(html).toContain('<li class="is-unavailable"><span aria-hidden="true">○</span>Audio</li>');
    expect(html).not.toContain("song-metadata");
  });

  it("gives a sparse YouTube-only song an intentional hero without empty shells", () => {
    const html = renderSongDetail({ ...song, youtubeUrl: "https://www.youtube.com/watch?v=abc123def45", youtubeVideoId: "abc123def45" }, "en");
    expect(html).toContain("detail-actions");
    expect(html).toContain('<li class="is-available"><span aria-hidden="true">●</span>YouTube</li>');
    expect(html).not.toContain("detail-unavailable");
    expect(html).not.toContain("song-metadata");
    expect(html).not.toContain("<audio");
  });

  it("renders only supplied resources", () => {
    const html = renderSongDetail({ ...song, audioUrl: "https://example.com/a.mp3", musicXmlUrl: "https://example.com/a.musicxml" }, "en");
    expect(html).toContain("<audio");
    expect(html).toContain("interactive-score");
    expect(html).toContain("Open interactive learning");
    expect(html).not.toContain("Loading score");
    expect(html).not.toContain("PDF score");
  });

  it("renders medium and full records without reserving missing metadata", () => {
    const medium = renderSongDetail({ ...song, audioUrl: "https://example.com/a.mp3", lyrics: { ka: "ტექსტი", en: "Lyrics" }, youtubeUrl: "https://youtu.be/abc123def45", youtubeVideoId: "abc123def45" }, "en");
    expect(medium).toContain("Play MP3");
    expect(medium).toContain("lyrics-panel");
    expect(medium).not.toContain("song-metadata");

    const full = renderSongDetail({ ...song, coverUrl: "https://example.com/cover.jpg", audioUrl: "https://example.com/a.mp3", lyrics: { ka: "ტექსტი", en: "Lyrics" }, musicXmlUrl: "https://example.com/a.musicxml", midiUrl: "https://example.com/a.mid", scorePdfUrl: "https://example.com/a.pdf", youtubeUrl: "https://youtu.be/abc123def45", youtubeVideoId: "abc123def45", composer: { ka: "ავტორი", en: "Composer" }, bpm: 96 }, "en");
    expect(full).toContain("song-metadata");
    expect(full).toContain('<li class="is-available"><span aria-hidden="true">●</span>Score</li>');
    expect(full).toContain("interactive-score");
    expect(full).toContain("pdf-panel");
  });

  it("supports a MIDI-only learning entry while keeping learning opt-in", () => {
    const html = renderSongDetail({ ...song, midiUrl: "https://example.com/a.mid", learningEnabled: true, learningInstruments: ["piano"] }, "en");
    expect(html).toContain("interactive-score");
    expect(html).toContain('data-learning-enabled="true"');
    expect(html).toContain('data-musicxml-url=""');
  });

  it("marks a private preview while reusing the song detail view", () => {
    const html = renderSongDetail({ ...song, musicXmlUrl: "https://example.com/a.musicxml", learningEnabled: true }, "en", { privateDraftPreview: true });
    expect(html).toContain("Private draft preview");
    expect(html).toContain('data-private-preview="true"');
    expect(html).toContain('href="#/admin"');
  });
});
