import type { LyricAlignment, LyricLine, LyricSyllable, LyricWord } from "./contracts";
import { splitSyllables } from "./lyrics-alignment";

/** Lyric timing built from the sung performance.
 *
 * The previous alignment distributed the authoritative text over the notes that pitch tracking
 * happened to find, which is why the first three lines of a song could be consumed in four seconds
 * while the singer was still holding the opening phrase. Notes are a poor clock: extraction invents
 * and drops them, and every error accumulates down the song.
 *
 * Here the clock is where the voice actually is. The vocal stem gives phrases - stretches with a
 * voice in them - and onsets, the syllable attacks inside those stretches. Text is laid out over
 * sung time only, so instrumental gaps are skipped instead of being filled with lyrics, and the
 * text is matched to the phrasing as a whole rather than line by line.
 *
 * The matching allows both shapes a real performance takes: one phrase can carry several lines when
 * the singer runs them together, and one line can span several phrases when a rest breaks it at a
 * caesura. Because every block begins at a real phrase start, an error cannot travel past the next
 * breath the singer takes - which is what stops the drift.
 *
 * Nothing here reads the audio for words: the lyric text is authoritative and untouched, and only
 * its timing is derived. */

export interface VocalPhrase {
  start: number;
  end: number;
}

export interface PerformanceLine {
  /** What is sung. A placeholder is allowed when the wording is not yet established. */
  text: string;
  /** True when the text is a placeholder and an owner still has to supply the real wording. */
  needsOwnerConfirmation?: boolean;
  /** How much singing this line is worth, in syllables. Supply it when the text is a placeholder:
   *  counting a placeholder's syllables would let invented words compete for real sung time. */
  syllableWeight?: number;
}

export interface PhraseAlignmentInput {
  authoritativeText: string;
  /** Sung before the first canonical line - an intro phrase this recording has and the authored
   *  poem does not. These are matched and timed exactly like canonical lines, which is why adding
   *  one re-times everything after it instead of shifting the timeline. */
  introLines?: readonly PerformanceLine[];
  phrases: readonly VocalPhrase[];
  /** Onset times from the vocal stem, used to place words inside a line. */
  onsets?: readonly number[];
  durationSeconds: number;
}

export interface PhraseAlignmentDiagnostics {
  lineCount: number;
  phraseCount: number;
  /** Lines whose start is a phrase start rather than a position inside one. */
  linesOnPhraseStart: number;
  /** Lines the singer broke across more than one phrase. */
  linesSpanningPhrases: number;
  /** Phrases carrying more than one line. */
  phrasesWithSeveralLines: number;
  /** Words placed on a detected onset rather than on a proportional estimate. */
  wordsOnOnsets: number;
  wordCount: number;
  /** Performance-only lines carried by this alignment but not by the authored text. */
  performanceLines: number;
  /** Syllables per sung second implied by the match; a sanity figure for a reviewer. */
  syllablesPerSecond: number;
  /** Syllable timing is only ever an estimate inside a word, so it is always review-grade. */
  syllableConfidence: "verified" | "review";
  sungSeconds: number;
}

export interface PhraseAlignmentResult {
  alignment: LyricAlignment;
  diagnostics: PhraseAlignmentDiagnostics;
}

/** Phrases, cleaned into a strictly increasing, non-overlapping list. */
function normalisePhrases(phrases: readonly VocalPhrase[]): VocalPhrase[] {
  const ordered = [...phrases].filter((phrase) => phrase.end > phrase.start).sort((left, right) => left.start - right.start);
  const merged: VocalPhrase[] = [];
  for (const phrase of ordered) {
    const previous = merged.at(-1);
    if (previous && phrase.start <= previous.end) { previous.end = Math.max(previous.end, phrase.end); continue; }
    merged.push({ ...phrase });
  }
  return merged;
}

/** Real seconds with the gaps between a set of phrases removed, so text can be spread across the
 *  singing without ever landing in a rest. */
class SungClock {
  private readonly offsets: number[] = [];
  readonly total: number;

  constructor(private readonly phrases: readonly VocalPhrase[]) {
    let sum = 0;
    for (const phrase of phrases) { this.offsets.push(sum); sum += phrase.end - phrase.start; }
    this.total = sum;
  }

  realTime(sungSeconds: number): number {
    if (!this.phrases.length) return sungSeconds;
    const position = Math.max(0, Math.min(this.total, sungSeconds));
    for (let index = this.phrases.length - 1; index >= 0; index -= 1) {
      if (position >= this.offsets[index] || index === 0) {
        const phrase = this.phrases[index];
        return Math.min(phrase.end, phrase.start + (position - this.offsets[index]));
      }
    }
    return this.phrases[0].start;
  }

  /** A time inside a gap maps to the start of the next phrase. */
  sungTime(realSeconds: number): number {
    if (!this.phrases.length) return realSeconds;
    for (let index = 0; index < this.phrases.length; index += 1) {
      const phrase = this.phrases[index];
      if (realSeconds < phrase.start) return this.offsets[index];
      if (realSeconds <= phrase.end) return this.offsets[index] + (realSeconds - phrase.start);
    }
    return this.total;
  }
}

const wordsOf = (line: string): string[] => line.split(/\s+/).filter(Boolean);
const syllableWeight = (word: string): number => Math.max(1, splitSyllables(word).length);

/** One run of lines matched to one run of phrases. */
export interface AlignmentBlock {
  lineFrom: number;
  lineTo: number;
  phraseFrom: number;
  phraseTo: number;
}

/** Match the text to the phrasing as a whole.
 *
 * Both sides may group: `lineTo - lineFrom` lines are sung across `phraseTo - phraseFrom` phrases.
 * A block costs the difference between the syllables it holds and the syllables its sung seconds
 * can carry at the song's own average rate, plus a small penalty for grouping, so a plain
 * one-line-per-phrase reading wins unless the audio really does not support it. */
export function matchLinesToPhrases(weights: readonly number[], phrases: readonly VocalPhrase[], maxLines = 4, maxPhrases = 4): AlignmentBlock[] {
  const lines = weights.length;
  const count = phrases.length;
  if (!lines || !count) return [];
  const prefixWeight = [0];
  for (const weight of weights) prefixWeight.push(prefixWeight.at(-1)! + weight);
  const prefixSung = [0];
  for (const phrase of phrases) prefixSung.push(prefixSung.at(-1)! + (phrase.end - phrase.start));
  const rate = prefixWeight[lines] / Math.max(0.001, prefixSung[count]);
  // Rests inside a candidate block. A breath is a caesura; sixteen seconds of instrumental is not,
  // and text must not be stretched across it.
  const prefixRest = [0];
  for (let index = 0; index < count; index += 1) {
    const gap = index === 0 ? 0 : Math.max(0, phrases[index].start - phrases[index - 1].end);
    prefixRest.push(prefixRest[index] + gap);
  }

  const best: number[][] = Array.from({ length: lines + 1 }, () => new Array(count + 1).fill(Number.POSITIVE_INFINITY));
  const choice: Array<Array<[number, number]>> = Array.from({ length: lines + 1 }, () => new Array(count + 1).fill([0, 0]));
  best[lines][count] = 0;

  for (let line = lines; line >= 0; line -= 1) {
    for (let phrase = count; phrase >= 0; phrase -= 1) {
      if (line === lines && phrase === count) continue;
      for (let takenLines = 1; takenLines <= Math.min(maxLines, lines - line); takenLines += 1) {
        for (let takenPhrases = 1; takenPhrases <= Math.min(maxPhrases, count - phrase); takenPhrases += 1) {
          const syllables = prefixWeight[line + takenLines] - prefixWeight[line];
          const seconds = prefixSung[phrase + takenPhrases] - prefixSung[phrase];
          // How many syllables this much singing should hold, against how many it was given.
          const mismatch = Math.abs(syllables - rate * seconds) / Math.max(1, rate);
          const rest = prefixRest[phrase + takenPhrases] - prefixRest[phrase + 1] + 0;
          const grouping = 0.45 * (takenPhrases - 1) + 0.3 * (takenLines - 1) + Math.max(0, rest - 0.8) * 1.6;
          const total = mismatch + grouping + best[line + takenLines][phrase + takenPhrases];
          if (total < best[line][phrase]) { best[line][phrase] = total; choice[line][phrase] = [takenLines, takenPhrases]; }
        }
      }
    }
  }

  const blocks: AlignmentBlock[] = [];
  let line = 0;
  let phrase = 0;
  while (line < lines && phrase < count) {
    const [takenLines, takenPhrases] = choice[line][phrase];
    if (!takenLines || !takenPhrases) break;
    blocks.push({ lineFrom: line, lineTo: line + takenLines, phraseFrom: phrase, phraseTo: phrase + takenPhrases });
    line += takenLines;
    phrase += takenPhrases;
  }
  // Nothing may be dropped: any remainder joins the last block rather than losing its timing.
  if (blocks.length && (line < lines || phrase < count)) {
    const last = blocks.at(-1)!;
    last.lineTo = lines;
    last.phraseTo = count;
  }
  if (!blocks.length) blocks.push({ lineFrom: 0, lineTo: lines, phraseFrom: 0, phraseTo: count });
  return blocks;
}

export function alignLyricsToPhrases(input: PhraseAlignmentInput): PhraseAlignmentResult {
  const phrases = normalisePhrases(input.phrases);
  const canonical = input.authoritativeText.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  // A performance intro is part of the sequence, not an offset applied to it: it takes its own
  // phrase, and every canonical line after it is matched to the singing that actually follows.
  const performance = (input.introLines ?? []).filter((line) => line.text.trim().length > 0);
  const texts = [...performance.map((line) => line.text.trim()), ...canonical];
  const performanceCount = performance.length;
  const onsets = [...(input.onsets ?? [])].sort((left, right) => left - right);
  const weights = texts.map((line, index) => {
    const supplied = index < performanceCount ? performance[index].syllableWeight : undefined;
    return supplied && supplied > 0 ? supplied : wordsOf(line).reduce((sum, word) => sum + syllableWeight(word), 0);
  });
  const whole = new SungClock(phrases);
  const blocks = phrases.length ? matchLinesToPhrases(weights, phrases) : [];

  const starts = new Array<number>(texts.length).fill(0);
  const ends = new Array<number>(texts.length).fill(0);
  let linesOnPhraseStart = 0;
  let linesSpanningPhrases = 0;
  let phrasesWithSeveralLines = 0;

  for (const block of blocks) {
    const own = phrases.slice(block.phraseFrom, block.phraseTo);
    if (!own.length) continue;
    const clock = new SungClock(own);
    const held = weights.slice(block.lineFrom, block.lineTo);
    const heldWeight = held.reduce((sum, weight) => sum + weight, 0) || 1;
    const lineCount = block.lineTo - block.lineFrom;
    if (lineCount > 1 && own.length === 1) phrasesWithSeveralLines += 1;
    if (lineCount === 1 && own.length > 1) linesSpanningPhrases += 1;

    let used = 0;
    for (let position = 0; position < lineCount; position += 1) {
      const index = block.lineFrom + position;
      const estimate = clock.realTime((used / heldWeight) * clock.total);
      used += held[position];
      ends[index] = clock.realTime((used / heldWeight) * clock.total);
      // A line boundary landing close to a phrase start belongs on it: that is where the singer
      // actually breathes, and it keeps the split inside a block honest.
      const nearest = own.reduce((bestPhrase, phrase) => Math.abs(phrase.start - estimate) < Math.abs(bestPhrase.start - estimate) ? phrase : bestPhrase, own[0]);
      starts[index] = Math.abs(nearest.start - estimate) <= 0.6 ? nearest.start : estimate;
      if (own.some((phrase) => Math.abs(phrase.start - starts[index]) < 0.01)) linesOnPhraseStart += 1;
    }
    // A block ends when its singing ends, so nothing stays lit through the rest that follows.
    ends[block.lineTo - 1] = own.at(-1)!.end;
  }

  for (let index = 0; index < starts.length; index += 1) {
    if (index > 0 && starts[index] <= starts[index - 1]) starts[index] = starts[index - 1] + 0.12;
    if (index > 0 && ends[index - 1] > starts[index]) ends[index - 1] = Math.max(starts[index - 1] + 0.2, starts[index] - 0.02);
    // Whatever the block arithmetic produced, a line stops when the phrase it started in stops.
    // Otherwise one line stays highlighted straight through an instrumental break.
    const own = phrases.find((phrase) => starts[index] >= phrase.start - 0.01 && starts[index] < phrase.end + 0.01);
    if (own && ends[index] > own.end) {
      const spans = ends[index] > own.end + 0.5 && phrases.some((phrase) => phrase.start > own.end && phrase.start < ends[index] && phrase.end <= ends[index] + 0.01);
      if (!spans) ends[index] = own.end;
    }
  }

  let wordsOnOnsets = 0;
  let wordCount = 0;
  const lines: LyricLine[] = texts.map((text, index) => {
    const lineStart = starts[index];
    const lineEnd = Math.max(lineStart + 0.35, ends[index] || lineStart + 0.5);
    const words = wordsOf(text);
    const wordWeights = words.map(syllableWeight);
    const lineWeight = wordWeights.reduce((sum, weight) => sum + weight, 0) || 1;
    const startSung = whole.sungTime(lineStart);
    const sungSpan = Math.max(0.05, whole.sungTime(lineEnd) - startSung);
    const inside = onsets.filter((onset) => onset > lineStart + 0.08 && onset < lineEnd - 0.05);

    const wordStarts: number[] = [];
    let used = 0;
    for (let position = 0; position < words.length; position += 1) {
      if (position === 0) { wordStarts.push(lineStart); used += wordWeights[0]; continue; }
      const estimate = whole.realTime(startSung + (used / lineWeight) * sungSpan);
      // Snap to a real attack when one sits close to where the text says this word should begin.
      const window = Math.min(0.4, Math.max(0.12, (sungSpan / Math.max(2, words.length)) * 0.7));
      const candidate = inside
        .filter((onset) => onset > wordStarts[position - 1] + 0.08 && Math.abs(onset - estimate) <= window)
        .sort((left, right) => Math.abs(left - estimate) - Math.abs(right - estimate))[0];
      if (candidate !== undefined) { wordStarts.push(candidate); wordsOnOnsets += 1; }
      else wordStarts.push(Math.max(wordStarts[position - 1] + 0.1, estimate));
      used += wordWeights[position];
    }
    wordCount += words.length;

    const built: LyricWord[] = words.map((word, position) => {
      const start = Math.min(wordStarts[position], lineEnd - 0.05);
      const end = Math.max(start + 0.08, position + 1 < words.length ? Math.min(wordStarts[position + 1], lineEnd) : lineEnd);
      const parts = splitSyllables(word);
      const step = (end - start) / Math.max(1, parts.length);
      const syllables: LyricSyllable[] = parts.map((part, syllableIndex) => ({
        id: `line-${index}-word-${position}-syllable-${syllableIndex}`,
        text: part,
        startSeconds: Number((start + syllableIndex * step).toFixed(3)),
        endSeconds: Number((start + (syllableIndex + 1) * step).toFixed(3)),
        noteIds: [],
      }));
      return { id: `line-${index}-word-${position}`, text: word, startSeconds: Number(start.toFixed(3)), endSeconds: Number(end.toFixed(3)), syllables };
    });

    const isPerformance = index < performanceCount;
    return {
      id: `line-${index}`, text, startSeconds: Number(lineStart.toFixed(3)), endSeconds: Number(lineEnd.toFixed(3)), words: built,
      origin: isPerformance ? "performance" as const : "canonical" as const,
      ...(isPerformance && performance[index].needsOwnerConfirmation ? { needsOwnerConfirmation: true } : {}),
    };
  });

  const totalSyllables = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    alignment: {
      version: 1,
      // The authored text, untouched. A performance line lives in `lines`, never here.
      authoritativeText: input.authoritativeText.replace(/\r\n/g, "\n").trim(),
      source: "forced-alignment",
      // Line and word timing come from the recording; syllable timing is still an estimate inside
      // a word, so the alignment as a whole stays review-grade until an owner confirms it.
      confidence: "review",
      lines,
    },
    diagnostics: {
      lineCount: lines.length,
      phraseCount: phrases.length,
      performanceLines: performanceCount,
      linesOnPhraseStart,
      linesSpanningPhrases,
      phrasesWithSeveralLines,
      wordsOnOnsets,
      wordCount,
      syllablesPerSecond: Number((totalSyllables / Math.max(0.001, whole.total)).toFixed(2)),
      syllableConfidence: "review",
      sungSeconds: Number(whole.total.toFixed(3)),
    },
  };
}
