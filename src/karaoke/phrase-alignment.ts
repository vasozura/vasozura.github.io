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

const maximumAllocationSeconds = 12;
const minimumLineSeconds = 0.75;

function guardedPhrases(phrases: readonly VocalPhrase[], onsets: readonly number[]): VocalPhrase[] {
  if (!onsets.length || !phrases.some((phrase) => phrase.end - phrase.start > maximumAllocationSeconds)) return [...phrases];
  const guarded: VocalPhrase[] = [];
  for (const phrase of phrases) {
    const inside = onsets.filter((onset) => onset >= phrase.start && onset <= phrase.end);
    if (!inside.length) continue;
    let start = phrase.start;
    while (phrase.end - start > maximumAllocationSeconds) {
      const cut = inside.filter((onset) => onset > start + minimumLineSeconds && onset <= start + maximumAllocationSeconds).at(-1);
      if (cut === undefined || phrase.end - cut < minimumLineSeconds) break;
      guarded.push({ start, end: cut });
      start = cut;
    }
    guarded.push({ start, end: phrase.end });
  }
  return guarded;
}

/** Split units are half-open. At a shared boundary the following unit owns the line start; only
 * the final unit accepts its end. Return the clamp decision so the boundary rule is testable. */
export function clampLineEndToContainingPhrase(phrases: readonly VocalPhrase[], start: number, end: number): { phraseIndex: number; end: number } {
  const phraseIndex = phrases.findIndex((phrase, index) => start >= phrase.start - 0.01 && (index === phrases.length - 1 ? start <= phrase.end + 0.01 : start < phrase.end));
  if (phraseIndex < 0) return { phraseIndex, end };
  const own = phrases[phraseIndex];
  if (end <= own.end) return { phraseIndex, end };
  const spans = end > own.end + 0.5 && phrases.some((phrase, index) => index > phraseIndex && phrase.start >= own.end - 0.01 && phrase.start < end && phrase.end <= end + 0.01);
  return { phraseIndex, end: spans ? end : own.end };
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
export function matchLinesToPhrases(weights: readonly number[], phrases: readonly VocalPhrase[], maxLines = 4, maxPhrases = 4, onsets?: readonly number[]): AlignmentBlock[] {
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
          if (onsets) {
            const first = phrases[phrase];
            const last = phrases[phrase + takenPhrases - 1];
            const evidence = onsets.filter((onset) => onset >= first.start && onset <= last.end).length;
            if (!evidence || seconds > maximumAllocationSeconds || evidence < takenLines || seconds < minimumLineSeconds * takenLines) continue;
          }
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
  if (onsets && (line < lines || phrase < count)) {
    throw new Error(`Insufficient onset-backed phrase evidence to allocate ${lines - line} lyric line(s) and ${count - phrase} phrase unit(s) safely.`);
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
  const onsets = [...(input.onsets ?? [])].sort((left, right) => left - right);
  const normalised = normalisePhrases(input.phrases);
  const phrases = guardedPhrases(normalised, onsets);
  const guarded = phrases.length !== normalised.length;
  const canonical = input.authoritativeText.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !/^\[[^\]\n]+\]$/.test(line));
  // A performance intro is part of the sequence, not an offset applied to it: it takes its own
  // phrase, and every canonical line after it is matched to the singing that actually follows.
  const performance = (input.introLines ?? []).filter((line) => line.text.trim().length > 0);
  const texts = [...performance.map((line) => line.text.trim()), ...canonical];
  const performanceCount = performance.length;
  const weights = texts.map((line, index) => {
    const supplied = index < performanceCount ? performance[index].syllableWeight : undefined;
    return supplied && supplied > 0 ? supplied : wordsOf(line).reduce((sum, word) => sum + syllableWeight(word), 0);
  });
  const whole = new SungClock(phrases);
  const blocks = phrases.length ? matchLinesToPhrases(weights, phrases, 4, 4, guarded ? onsets : undefined) : [];

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

    const boundaries = [own[0].start];
    let used = 0;
    for (let position = 1; position < lineCount; position += 1) {
      used += held[position - 1];
      const estimate = clock.realTime((used / heldWeight) * clock.total);
      const earliest = boundaries.at(-1)! + minimumLineSeconds;
      const latest = own.at(-1)!.end - minimumLineSeconds * (lineCount - position);
      if (earliest > latest) throw new Error(`Allocation block ${block.lineFrom + 1}-${block.lineTo} has insufficient non-overlapping duration.`);
      const candidates = [...own.map((phrase) => phrase.start), ...onsets.filter((onset) => onset > own[0].start && onset < own.at(-1)!.end)]
        .filter((candidate) => candidate >= earliest && candidate <= latest)
        .sort((left, right) => Math.abs(left - estimate) - Math.abs(right - estimate));
      const boundary = candidates[0] !== undefined && Math.abs(candidates[0] - estimate) <= 0.6 ? candidates[0] : Math.max(earliest, Math.min(latest, estimate));
      boundaries.push(boundary);
    }
    boundaries.push(own.at(-1)!.end);
    for (let position = 0; position < lineCount; position += 1) {
      const index = block.lineFrom + position;
      starts[index] = boundaries[position];
      ends[index] = boundaries[position + 1];
      if (own.some((phrase) => Math.abs(phrase.start - starts[index]) < 0.01)) linesOnPhraseStart += 1;
    }
  }

  for (let index = 0; index < starts.length; index += 1) {
    if (index > 0 && starts[index] < ends[index - 1] - 0.001) throw new Error(`Lyric allocation overlaps between lines ${index} and ${index + 1}.`);
    if (phrases.length && ends[index] - starts[index] < minimumLineSeconds - 0.001) throw new Error(`Lyric line ${index + 1} has only ${(ends[index] - starts[index]).toFixed(3)} seconds of supported timing.`);
    // Whatever the block arithmetic produced, a line stops when the phrase it started in stops.
    // Otherwise one line stays highlighted straight through an instrumental break.
    ends[index] = clampLineEndToContainingPhrase(phrases, starts[index], ends[index]).end;
    if (phrases.length && ends[index] <= starts[index]) throw new Error(`Lyric line ${index + 1} has no positive allocation window.`);
  }

  let wordsOnOnsets = 0;
  let wordCount = 0;
  const lines: LyricLine[] = texts.map((text, index) => {
    const lineStart = starts[index];
    const lineEnd = phrases.length ? ends[index] : lineStart + 0.5;
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
