import { describe, expect, it } from "vitest";
import { alignLyricsToPhrases, matchLinesToPhrases, type VocalPhrase } from "./phrase-alignment";
import { resolveTimeline } from "./timeline";

const phrase = (start: number, end: number): VocalPhrase => ({ start, end });
/** Four sung phrases with a long instrumental break between the second and the third. */
const sung: VocalPhrase[] = [phrase(2, 8), phrase(9, 15), phrase(40, 46), phrase(47, 53)];
const text = "mze da mta gvaqvs\nsheni guli chemtan\nqari da tsvima modis\ndila mova male";
/** Onsets roughly where words would start inside each phrase. */
const onsets = sung.flatMap((item) => [0, 1.4, 2.9, 4.3].map((offset) => item.start + offset));

describe("lyric timing built from sung phrases", () => {
  it("starts the first line where the singing starts, not at zero", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    expect(alignment.lines[0].startSeconds).toBeCloseTo(2, 1);
  });

  it("never places a line in an instrumental gap", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    for (const line of alignment.lines) {
      expect(sung.some((item) => line.startSeconds >= item.start - 0.05 && line.startSeconds < item.end)).toBe(true);
    }
  });

  it("does not leave a line highlighted across a rest", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    for (const line of alignment.lines) {
      const own = sung.find((item) => line.startSeconds >= item.start - 0.05 && line.startSeconds < item.end)!;
      // A line may run to the end of its own phrase, never into the silence after it.
      expect(line.endSeconds).toBeLessThanOrEqual(own.end + 0.05);
    }
  });

  it("keeps the authoritative text exactly, in order", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    expect(alignment.lines.map((line) => line.text)).toEqual(text.split("\n"));
    expect(alignment.authoritativeText).toBe(text);
  });

  it("spreads words across the line instead of stacking them at its start", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    const words = alignment.lines[0].words;
    expect(words.length).toBeGreaterThan(2);
    for (let index = 1; index < words.length; index += 1) expect(words[index].startSeconds).toBeGreaterThan(words[index - 1].startSeconds);
    // The last word starts in the second half of the line rather than immediately.
    const line = alignment.lines[0];
    expect(words.at(-1)!.startSeconds).toBeGreaterThan(line.startSeconds + (line.endSeconds - line.startSeconds) * 0.4);
  });

  it("does not stretch text over a long instrumental break", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    // 15s -> 40s is instrumental: no line may span it.
    expect(alignment.lines.some((line) => line.startSeconds < 15 && line.endSeconds > 40)).toBe(false);
  });

  it("marks syllable timing as review-grade rather than claiming it was measured", () => {
    const result = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    expect(result.diagnostics.syllableConfidence).toBe("review");
    expect(result.alignment.confidence).toBe("review");
    expect(result.alignment.source).toBe("forced-alignment");
  });

  it("gives every timed element a stable id the timeline can resolve", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    const ids = alignment.lines.flatMap((line) => [line.id, ...line.words.flatMap((word) => [word.id, ...word.syllables.map((syllable) => syllable.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
    const line = alignment.lines[1];
    const position = resolveTimeline({ alignment, originalNotes: [] }, line.startSeconds + 0.05);
    expect(position.line?.id).toBe(line.id);
  });

  it("survives a song with no detected singing at all", () => {
    const result = alignLyricsToPhrases({ authoritativeText: text, phrases: [], onsets: [], durationSeconds: 60 });
    expect(result.alignment.lines).toHaveLength(4);
    expect(result.diagnostics.phraseCount).toBe(0);
  });
});

describe("matching lines to phrases", () => {
  it("takes one line per phrase when the syllables fit", () => {
    const blocks = matchLinesToPhrases([8, 8, 8, 8], sung);
    expect(blocks).toHaveLength(4);
    expect(blocks.every((block) => block.lineTo - block.lineFrom === 1)).toBe(true);
  });

  it("lets one phrase carry two lines the singer ran together", () => {
    const blocks = matchLinesToPhrases([6, 6, 6], [phrase(0, 12), phrase(13, 19)]);
    expect(blocks[0].lineTo - blocks[0].lineFrom).toBe(2);
    expect(blocks[1].lineTo - blocks[1].lineFrom).toBe(1);
  });

  it("lets one line span two phrases broken by a breath", () => {
    // One line of ten syllables sung as two halves, then two ordinary lines.
    const blocks = matchLinesToPhrases([10, 5, 5], [phrase(0, 5), phrase(5.4, 10), phrase(11, 16), phrase(17, 22)]);
    expect(blocks[0]).toEqual({ lineFrom: 0, lineTo: 1, phraseFrom: 0, phraseTo: 2 });
  });

  it("assigns every line and every phrase exactly once", () => {
    const blocks = matchLinesToPhrases([7, 7, 7, 7, 7], sung);
    expect(blocks[0].lineFrom).toBe(0);
    expect(blocks.at(-1)!.lineTo).toBe(5);
    expect(blocks.at(-1)!.phraseTo).toBe(sung.length);
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index].lineFrom).toBe(blocks[index - 1].lineTo);
      expect(blocks[index].phraseFrom).toBe(blocks[index - 1].phraseTo);
    }
  });
});
