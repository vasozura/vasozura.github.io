import type { LyricAlignment, LyricLine, LyricSyllable, LyricWord } from "./contracts";
import { splitSyllables } from "./lyrics-alignment";

/* Karaoke timing taken from the generator's own forced alignment.
 *
 * Suno aligns the prompt lyrics against the audio it rendered and publishes the result as
 * `aligned_lyrics`: one token per written word, each carrying the seconds it is sung. That is a
 * measurement of this exact recording, so it - not any local guess about singing rate, syllable
 * distribution or vocal energy - decides where every lyric sits.
 *
 * Two things are derived here and nothing else:
 *   - line grouping, because the payload carries no line field: the newlines and section markers
 *     that Suno embedded inside the token text are put back together and split into lines;
 *   - the end of a highlight, which may optionally be cut short at a silence (see `sungWindows`).
 *
 * The authored poem is never rewritten. It stays in `authoritativeText`, and a sung line is marked
 * canonical only when it is that poem's line word for word; every repeat, answer and hold the
 * performance adds is carried as a performance line. */

/** One token exactly as `aligned_lyrics` returns it. `word` carries its own trailing separator, and
 *  any section marker or blank line that preceded it, which is how line grouping survives. */
export interface SunoAlignedWord {
  word: string;
  start_s: number;
  end_s: number;
  success?: boolean;
  p_align?: number;
}

/** A stretch of the vocal stem with a voice in it. Optional, and used for one purpose only: a
 *  highlight is not allowed to run on across a silence. No lyric position is taken from it - every
 *  start and end still comes from Suno - it can only cut a highlight short. */
export interface SungWindow { start: number; end: number }

export interface SunoTimelineInput {
  /** The authored poem, exactly as the song record holds it. Copied through untouched. */
  authoritativeText: string;
  sungWindows?: readonly SungWindow[];
  /** How far outside a sung window a word may start and still count as sung. */
  toleranceSeconds?: number;
}

/** A `[...]` marker in the prompt - an arrangement note, not a lyric. Kept for provenance. */
export interface SunoSection { label: string; startSeconds: number }

export interface SunoTimelineDiagnostics {
  tokenCount: number;
  lineCount: number;
  canonicalLineCount: number;
  performanceLineCount: number;
  sectionCount: number;
  /** Words whose Suno end was cut back to a silence rather than held across it. */
  clampedWordCount: number;
  /** Words that begin where the stem has no voice and never reach any. They keep their text and
   *  their place in the line, and are never highlighted. */
  silentWordCount: number;
  firstSungSeconds: number;
  lastSungSeconds: number;
}

export interface SunoTimelineResult {
  alignment: LyricAlignment;
  /** What this recording actually sings, line by line. Never written back to the song's lyrics. */
  performanceText: string;
  sections: SunoSection[];
  diagnostics: SunoTimelineDiagnostics;
}

const isToken = (value: unknown): value is SunoAlignedWord =>
  typeof value === "object" && value !== null
  && typeof (value as SunoAlignedWord).word === "string"
  && typeof (value as SunoAlignedWord).start_s === "number"
  && Number.isFinite((value as SunoAlignedWord).start_s)
  && (value as SunoAlignedWord).start_s >= 0
  && typeof (value as SunoAlignedWord).end_s === "number"
  && Number.isFinite((value as SunoAlignedWord).end_s)
  && (value as SunoAlignedWord).end_s >= (value as SunoAlignedWord).start_s;

/** Pull the token list out of an `aligned_lyrics` response.
 *
 * The endpoint wraps it in `data` alongside per-frame numbers we have no use for, and has been seen
 * to return the tokens both directly and one level deeper, so the first array of tokens wins rather
 * than a fixed index. */
export function parseSunoAlignedLyrics(payload: unknown): SunoAlignedWord[] {
  const seen = new Set<unknown>();
  const search = (value: unknown): SunoAlignedWord[] | null => {
    if (Array.isArray(value)) {
      if (value.length && value.every(isToken)) return value;
      for (const item of value) {
        const found = search(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "object" && value !== null && !seen.has(value)) {
      seen.add(value);
      for (const item of Object.values(value as Record<string, unknown>)) {
        const found = search(item);
        if (found) return found;
      }
    }
    return null;
  };
  const tokens = search(payload);
  if (!tokens) throw new Error("No aligned_lyrics tokens found in the payload.");
  return [...tokens].sort((a, b) => a.start_s - b.start_s);
}

const SECTION = /^\[[^\]]*\]$/;
const SEPARATOR = /^-{3,}$/;
const HAS_TEXT = /[\p{L}\p{N}]/u;
const normalise = (text: string): string => text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
const round = (value: number): number => Number(value.toFixed(3));

interface Slice { token: SunoAlignedWord; text: string }

/** Put the written lyric back together from the tokens, then cut it at its own newlines.
 *
 * Each returned line knows which tokens wrote it and what each of them contributed, so a token that
 * ends a line and opens the next ("თვალი.\n\n[Lead]\nსაფიცავად ") lands in both. */
function sliceIntoLines(tokens: readonly SunoAlignedWord[]): Slice[][] {
  const lines: Slice[][] = [];
  let current: Slice[] = [];
  for (const token of tokens) {
    const parts = token.word.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) { lines.push(current); current = []; }
      if (part) current.push({ token, text: part });
    });
  }
  lines.push(current);
  return lines;
}

const sliceText = (slices: readonly Slice[]): string => slices.map((slice) => slice.text).join("").trim();

export function buildSunoTimeline(payload: unknown, input: SunoTimelineInput): SunoTimelineResult {
  const tokens = parseSunoAlignedLyrics(payload);
  const tolerance = input.toleranceSeconds ?? 0.15;
  const windows = [...(input.sungWindows ?? [])].sort((a, b) => a.start - b.start);
  const windowAt = (seconds: number): SungWindow | null =>
    windows.find((item) => seconds >= item.start - tolerance && seconds < item.end + tolerance) ?? null;

  const authoritative = input.authoritativeText.replace(/\r\n/g, "\n").trim();
  const canonical = new Set(authoritative.split("\n").map((line) => normalise(line)).filter(Boolean));

  const sections: SunoSection[] = [];
  const rows: Array<{ text: string; slices: Slice[] }> = [];
  for (const slices of sliceIntoLines(tokens)) {
    const text = sliceText(slices);
    if (!text || SEPARATOR.test(text)) continue;
    if (SECTION.test(text)) {
      if (slices.length) sections.push({ label: text.slice(1, -1).trim(), startSeconds: round(slices[0].token.start_s) });
      continue;
    }
    if (!HAS_TEXT.test(text)) continue;
    rows.push({ text, slices: slices.filter((slice) => HAS_TEXT.test(slice.text)) });
  }

  let clampedWordCount = 0;
  let silentWordCount = 0;
  const lines: LyricLine[] = rows.map((row, index) => {
    const words: LyricWord[] = row.slices.map((slice, position) => {
      let start = slice.token.start_s;
      const next = row.slices[position + 1]?.token.start_s ?? Number.POSITIVE_INFINITY;
      let end = Math.min(slice.token.end_s, next);
      if (windows.length) {
        const window = windowAt(start);
        if (window) {
          if (end > window.end) { clampedWordCount += 1; end = window.end; }
        } else {
          // A local acoustic window is never allowed to move or invent a Suno onset. If that onset
          // is outside the verified singing, retain the token in the performance text but give it
          // no highlight duration. The optional window may only shorten an ending.
          silentWordCount += 1;
          end = start;
        }
      }
      end = Math.max(start, end);
      const parts = splitSyllables(slice.text.trim());
      const step = (end - start) / Math.max(1, parts.length);
      const syllables: LyricSyllable[] = parts.map((part, syllableIndex) => ({
        id: `line-${index}-word-${position}-syllable-${syllableIndex}`,
        text: part,
        startSeconds: round(start + syllableIndex * step),
        endSeconds: round(start + (syllableIndex + 1) * step),
        noteIds: [],
      }));
      return { id: `line-${index}-word-${position}`, text: slice.text.trim(), startSeconds: round(start), endSeconds: round(end), syllables };
    });
    const startSeconds = words.length ? words[0].startSeconds : 0;
    // Only a word that is actually sung may hold the line open: a word the aligner placed in a
    // silence has no duration, and must not keep the line lit until its own start.
    const endSeconds = words.reduce((latest, word) => word.endSeconds > word.startSeconds ? Math.max(latest, word.endSeconds) : latest, startSeconds);
    return {
      id: `line-${index}`,
      text: row.text,
      startSeconds,
      endSeconds,
      words,
      origin: canonical.has(normalise(row.text)) ? "canonical" : "performance",
    };
  });

  // A line whose every word fell in a silence would otherwise sit at zero length on the timeline and
  // still answer `lineAt` at its own start. Give it no span at all instead.
  for (const line of lines) if (line.endSeconds <= line.startSeconds) line.endSeconds = line.startSeconds;

  const sung = lines.filter((line) => line.endSeconds > line.startSeconds);
  return {
    alignment: {
      version: 1,
      authoritativeText: authoritative,
      source: "suno-aligned-lyrics",
      // Line and word timing were measured against this recording by the generator that made it.
      confidence: "verified",
      lines,
    },
    performanceText: lines.map((line) => line.text).join("\n"),
    sections,
    diagnostics: {
      tokenCount: tokens.length,
      lineCount: lines.length,
      canonicalLineCount: lines.filter((line) => line.origin === "canonical").length,
      performanceLineCount: lines.filter((line) => line.origin === "performance").length,
      sectionCount: sections.length,
      clampedWordCount,
      silentWordCount,
      firstSungSeconds: sung.length ? sung[0].startSeconds : 0,
      lastSungSeconds: sung.reduce((latest, line) => Math.max(latest, line.endSeconds), 0),
    },
  };
}
