import { describe, expect, it } from "vitest";
import type { KaraokeChord } from "./contracts";
import { createChordedLyrics } from "./exports";
import { alignLyricsToNotes } from "./lyrics-alignment";
import { createLearningNotes } from "./vocal-midi";

const raw = (id: string, midi: number, startSeconds: number) =>
  ({ id, midi, startSeconds, durationSeconds: .5, velocity: .8, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: startSeconds });

function fixture() {
  const notes = createLearningNotes([raw("a", 60, 0), raw("b", 62, .6), raw("c", 64, 1.2), raw("d", 65, 1.8)]);
  return alignLyricsToNotes("mze da mta gvaqvs\nsheni guli", notes);
}

const chord = (id: string, symbol: string, wordId: string, startSeconds: number): KaraokeChord =>
  ({ id, symbol, startSeconds, endSeconds: startSeconds + 2, wordId, source: "analysis" });

describe("chorded lyric text", () => {
  it("starts each symbol at the column of the word it belongs to", () => {
    const { alignment } = fixture();
    const words = alignment.lines[0].words;
    const text = createChordedLyrics(alignment, [chord("c0", "Am", words[0].id, 0), chord("c1", "F", words[2].id, 1.2)]);
    const [chordRow, lyricRow] = text.split("\n");
    expect(lyricRow).toBe("mze da mta gvaqvs");
    // "mta" starts at column 7 of the lyric line, so "F" starts at column 7 of the chord row.
    expect(chordRow.indexOf("Am")).toBe(0);
    expect(chordRow.indexOf("F")).toBe(lyricRow.indexOf("mta"));
  });

  it("does not let two symbols touch when their words are adjacent", () => {
    const { alignment } = fixture();
    const words = alignment.lines[0].words;
    const row = createChordedLyrics(alignment, [chord("c0", "Cmaj7", words[0].id, 0), chord("c1", "Dm", words[1].id, .6)]).split("\n")[0];
    expect(row).toBe("Cmaj7 Dm");
    expect(row).not.toContain("Cmaj7Dm");
  });

  it("leaves a line without chords as plain lyrics", () => {
    const { alignment } = fixture();
    const text = createChordedLyrics(alignment, [chord("c0", "Am", alignment.lines[0].words[0].id, 0)]);
    expect(text.trimEnd().split("\n\n")[1]).toBe("sheni guli");
  });

  it("keeps Georgian columns aligned, where one character is one column", () => {
    const notes = createLearningNotes([raw("a", 60, 0), raw("b", 62, .6)]);
    const { alignment } = alignLyricsToNotes("მზეო თიბათვისა", notes);
    const words = alignment.lines[0].words;
    const [row, lyrics] = createChordedLyrics(alignment, [chord("c0", "G", words[1].id, .6)]).split("\n");
    expect(row.indexOf("G")).toBe([...lyrics].indexOf("თ"));
  });
});
