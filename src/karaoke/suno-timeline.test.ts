import { describe, expect, it } from "vitest";
import { buildSunoTimeline, parseSunoAlignedLyrics, type SunoAlignedWord } from "./suno-timeline";
import { resolveTimeline } from "./timeline";

const token = (word: string, start: number, end: number): SunoAlignedWord => ({ word, start_s: start, end_s: end, success: true, p_align: 0.99 });

/** Shaped like the real payload: a cold open the poem does not contain, a section marker, a "---"
 *  separator, then two lines of the authored text. */
const tokens: SunoAlignedWord[] = [
  token("[Cold Open]\nmze ", 0.5, 1),
  token("da ", 1.1, 1.3),
  token("mta...\n\n---\n\n", 1.4, 2),
  token("[Verse 1]\nsheni ", 3, 3.4),
  token("guli ", 3.5, 3.9),
  token("chemtan;\n", 4, 4.6),
  token("qari ", 4.7, 5),
  token("da ", 5.1, 5.3),
  token("tsvima ", 5.4, 5.9),
  token("modis.\n\n[ END]\n", 6, 6.8),
];
const authoritativeText = "sheni guli chemtan;\nqari da tsvima modis.";
const payload = { data: [tokens, [0.1, 0.2], 0.5] };

describe("reading the aligned_lyrics payload", () => {
  it("finds the tokens however deeply the response wraps them", () => {
    expect(parseSunoAlignedLyrics(payload)).toHaveLength(tokens.length);
    expect(parseSunoAlignedLyrics(tokens)).toHaveLength(tokens.length);
    expect(parseSunoAlignedLyrics({ data: { aligned_words: tokens } })).toHaveLength(tokens.length);
  });

  it("refuses a payload with no tokens rather than returning an empty timeline", () => {
    expect(() => parseSunoAlignedLyrics({ data: [[], 1] })).toThrow(/aligned_lyrics/);
  });

  it("returns the tokens in sung order", () => {
    const shuffled = [tokens[3], tokens[0], tokens[1], tokens[2], ...tokens.slice(4)];
    expect(parseSunoAlignedLyrics(shuffled).map((item) => item.start_s)).toEqual([...tokens].map((item) => item.start_s).sort((a, b) => a - b));
  });
});

describe("the timeline Suno measured", () => {
  const built = buildSunoTimeline(payload, { authoritativeText });

  it("groups tokens into the lines the written lyric had", () => {
    expect(built.alignment.lines.map((line) => line.text)).toEqual([
      "mze da mta...",
      "sheni guli chemtan;",
      "qari da tsvima modis.",
    ]);
  });

  it("keeps section markers and separators out of the sung lines", () => {
    expect(built.alignment.lines.some((line) => line.text.includes("["))).toBe(false);
    expect(built.alignment.lines.some((line) => line.text.includes("---"))).toBe(false);
    expect(built.sections.map((section) => section.label)).toEqual(["Cold Open", "Verse 1", "END"]);
    expect(built.sections[1].startSeconds).toBe(3);
  });

  it("takes every start and end from Suno rather than recomputing them", () => {
    const line = built.alignment.lines[1];
    expect(line.startSeconds).toBe(3);
    expect(line.endSeconds).toBe(4.6);
    expect(line.words.map((word) => [word.text, word.startSeconds, word.endSeconds])).toEqual([
      ["sheni", 3, 3.4], ["guli", 3.5, 3.9], ["chemtan;", 4, 4.6],
    ]);
  });

  it("marks the poem's own lines canonical and everything else performance", () => {
    expect(built.alignment.lines.map((line) => line.origin)).toEqual(["performance", "canonical", "canonical"]);
    expect(built.diagnostics.canonicalLineCount).toBe(2);
    expect(built.diagnostics.performanceLineCount).toBe(1);
  });

  it("never writes the performance transcript into the authored lyrics", () => {
    expect(built.alignment.authoritativeText).toBe(authoritativeText);
    expect(built.alignment.authoritativeText).not.toContain("mze");
    expect(built.performanceText.split("\n")).toHaveLength(3);
    expect(built.performanceText).toContain("mze da mta...");
  });

  it("gives every timed element an id the shared timeline can resolve", () => {
    const ids = built.alignment.lines.flatMap((line) => [line.id, ...line.words.flatMap((word) => [word.id, ...word.syllables.map((syllable) => syllable.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
    const line = built.alignment.lines[2];
    expect(resolveTimeline({ alignment: built.alignment, originalNotes: [] }, line.startSeconds + 0.05).line?.id).toBe(line.id);
  });

  it("leaves the instrumental stretch between two lines unlit", () => {
    const position = resolveTimeline({ alignment: built.alignment, originalNotes: [] }, 2.5);
    expect(position.line).toBeNull();
    expect(position.isInstrumental).toBe(true);
    expect(position.upcomingLine?.text).toBe("sheni guli chemtan;");
  });

  it("reports what it built", () => {
    expect(built.diagnostics).toMatchObject({ tokenCount: 10, lineCount: 3, sectionCount: 3, clampedWordCount: 0, heldWordCount: 0, silentWordCount: 0 });
    expect(built.diagnostics.firstSungSeconds).toBe(0.5);
    expect(built.diagnostics.lastSungSeconds).toBe(6.8);
  });
});

describe("a highlight is not held across a silence", () => {
  // The stem stops singing at 1.6s and starts again at 3s: the aligner stretched "mta..." to 2s.
  const sungWindows = [{ start: 0.4, end: 1.6 }, { start: 2.9, end: 7 }];

  it("cuts a stretched word back to the end of the singing", () => {
    const built = buildSunoTimeline(payload, { authoritativeText, sungWindows });
    const word = built.alignment.lines[0].words[2];
    expect(word.startSeconds).toBe(1.4);
    expect(word.endSeconds).toBe(1.6);
    expect(built.alignment.lines[0].endSeconds).toBe(1.6);
    expect(built.diagnostics.clampedWordCount).toBe(1);
  });

  it("never lights a word the aligner stretched across an instrumental passage", () => {
    // "aaa..." is opened at 2.2s but the singing does not come back until 20s: nothing may be lit in
    // between, so the word keeps its place in the line and is given no duration at all.
    const late = [...sungWindows, { start: 20, end: 30 }];
    const stray = [...tokens, token("aaa...\n", 8, 25)];
    const built = buildSunoTimeline({ data: [stray] }, { authoritativeText, sungWindows: late });
    const line = built.alignment.lines[3];
    expect(line.text).toBe("aaa...");
    expect(line.endSeconds).toBe(line.startSeconds);
    expect(built.diagnostics.silentWordCount).toBe(1);
    for (const seconds of [8.4, 15, 21]) {
      const position = resolveTimeline({ alignment: built.alignment, originalNotes: [] }, seconds);
      expect(position.line).toBeNull();
      expect(position.isInstrumental).toBe(true);
    }
  });

  it("holds a word opened a fraction early to the attack that follows", () => {
    // 2.85s is 50ms before the singing resumes: that is the aligner being early, not a rest.
    const stray = [...tokens.slice(0, 3), token("aaa...\n", 2.6, 3.6), ...tokens.slice(3)];
    const built = buildSunoTimeline({ data: [stray] }, { authoritativeText, sungWindows });
    const line = built.alignment.lines[1];
    expect(line.startSeconds).toBe(2.9);
    expect(line.endSeconds).toBe(3.6);
    expect(built.diagnostics.heldWordCount).toBe(1);
    expect(built.diagnostics.silentWordCount).toBe(0);
  });

  it("changes nothing when the singing covers what Suno measured", () => {
    const plain = buildSunoTimeline(payload, { authoritativeText });
    const masked = buildSunoTimeline(payload, { authoritativeText, sungWindows: [{ start: 0, end: 30 }] });
    expect(masked.alignment.lines).toEqual(plain.alignment.lines);
    expect(masked.diagnostics.clampedWordCount).toBe(0);
  });
});
