import { describe, expect, it } from "vitest";
import { alignLyricsToPhrases, clampLineEndToContainingPhrase, matchLinesToPhrases, type VocalPhrase } from "./phrase-alignment";
import { resolveTimeline } from "./timeline";

const phrase = (start: number, end: number): VocalPhrase => ({ start, end });
/** Four sung phrases with a long instrumental break between the second and the third. */
const sung: VocalPhrase[] = [phrase(2, 8), phrase(9, 15), phrase(40, 46), phrase(47, 53)];
const text = "mze da mta gvaqvs\nsheni guli chemtan\nqari da tsvima modis\ndila mova male";
/** Onsets roughly where words would start inside each phrase. */
const onsets = sung.flatMap((item) => [0, 1.4, 2.9, 4.3].map((offset) => item.start + offset));

describe("lyric timing built from sung phrases", () => {
  it("assigns a shared boundary to the following guarded unit without collapsing the line", () => {
    const units = [phrase(52.744, 64.412), phrase(64.412, 75.651), phrase(75.651, 87.632)];
    const proposed = { start: 64.412, end: 68.158333 };
    const clamped = clampLineEndToContainingPhrase(units, proposed.start, proposed.end);

    expect(clamped.phraseIndex).toBe(1);
    expect(clamped.end).toBe(proposed.end);
    expect(clamped.end).toBeGreaterThan(proposed.start);
    expect(proposed.start).toBeGreaterThanOrEqual(units[0].end);
    expect(clamped.end).toBeLessThanOrEqual(units[1].end);

    const guarded = alignLyricsToPhrases({
      authoritativeText: "[Intro]\neight syllable ordinary line one\neight syllable ordinary line two\n[Verse]\neight syllable ordinary line three\neight syllable ordinary line four",
      phrases: [phrase(0, 30), phrase(31, 32), phrase(33, 39)],
      onsets: [1, 4, 7, 10, 10.1, 13, 16, 19, 22, 25, 28, 33.2, 35, 37],
      durationSeconds: 40,
    });
    expect(guarded.alignment.authoritativeText).toContain("[Intro]");
    expect(guarded.alignment.lines.some((line) => line.text.startsWith("["))).toBe(false);
    for (let index = 0; index < guarded.alignment.lines.length; index += 1) {
      const line = guarded.alignment.lines[index];
      expect(line.endSeconds - line.startSeconds).toBeGreaterThan(0.35);
      if (index) expect(line.startSeconds).toBeGreaterThanOrEqual(guarded.alignment.lines[index - 1].endSeconds);
    }
  });

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

describe("a performance intro the authored poem does not contain", () => {
  const intro = [{ text: "oh oh oh", needsOwnerConfirmation: true, syllableWeight: 6 }];
  // One phrase per line: the intro takes the first, so each canonical line still gets its own.
  const sungWithIntro: VocalPhrase[] = [...sung, phrase(55, 61)];

  it("takes the first sung phrase and pushes the canonical text to the singing that follows", () => {
    const plain = alignLyricsToPhrases({ authoritativeText: text, phrases: sung, onsets, durationSeconds: 60 });
    const withIntro = alignLyricsToPhrases({ authoritativeText: text, introLines: intro, phrases: sungWithIntro, onsets, durationSeconds: 60 });
    expect(withIntro.alignment.lines[0].origin).toBe("performance");
    expect(withIntro.alignment.lines[0].startSeconds).toBeCloseTo(sung[0].start, 1);
    // The first canonical line is no longer at the top of the song, and it did not simply shift by
    // a fixed amount: it was re-matched to the phrase the singer actually starts it on.
    const first = withIntro.alignment.lines.find((line) => line.origin !== "performance")!;
    expect(first.text).toBe(plain.alignment.lines[0].text);
    expect(first.startSeconds).toBeGreaterThan(plain.alignment.lines[0].startSeconds);
    expect(sungWithIntro.some((item) => Math.abs(item.start - first.startSeconds) < 0.05)).toBe(true);
  });

  it("never writes performance text into the authoritative lyrics", () => {
    const result = alignLyricsToPhrases({ authoritativeText: text, introLines: intro, phrases: sungWithIntro, onsets, durationSeconds: 60 });
    expect(result.alignment.authoritativeText).toBe(text);
    expect(result.alignment.authoritativeText).not.toContain("oh oh oh");
    expect(result.diagnostics.performanceLines).toBe(1);
    // The canonical lines are still the authored text, in order and unchanged.
    expect(result.alignment.lines.filter((line) => line.origin !== "performance").map((line) => line.text)).toEqual(text.split("\n"));
  });

  it("marks a placeholder intro as needing the owner's wording", () => {
    const result = alignLyricsToPhrases({ authoritativeText: text, introLines: intro, phrases: sungWithIntro, onsets, durationSeconds: 60 });
    expect(result.alignment.lines[0].needsOwnerConfirmation).toBe(true);
    expect(result.alignment.lines[1].needsOwnerConfirmation).toBeUndefined();
  });

  it("uses the supplied syllable weight instead of counting placeholder words", () => {
    const light = alignLyricsToPhrases({ authoritativeText: text, introLines: [{ text: "aaa", syllableWeight: 1 }], phrases: sungWithIntro, onsets, durationSeconds: 60 });
    const heavy = alignLyricsToPhrases({ authoritativeText: text, introLines: [{ text: "aaa", syllableWeight: 40 }], phrases: sungWithIntro, onsets, durationSeconds: 60 });
    expect(heavy.alignment.lines[0].endSeconds).toBeGreaterThan(light.alignment.lines[0].endSeconds);
  });

  it("still times and highlights the intro like any other line", () => {
    const { alignment } = alignLyricsToPhrases({ authoritativeText: text, introLines: intro, phrases: sungWithIntro, onsets, durationSeconds: 60 });
    const line = alignment.lines[0];
    expect(line.endSeconds).toBeGreaterThan(line.startSeconds);
    expect(line.words.length).toBeGreaterThan(0);
    expect(resolveTimeline({ alignment, originalNotes: [] }, line.startSeconds + 0.05).line?.id).toBe(line.id);
  });
});
