import type { KaraokeChord, LearningVocalNote, LyricAlignment } from "./contracts";
import { splitSyllables } from "./lyrics-alignment";
import { learningTimeFromOriginalTime } from "./vocal-midi";

const pitchClasses = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;
const aliases: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, "C♯": 1, Db: 1, "D♭": 1, D: 2, "D#": 3, "D♯": 3,
  Eb: 3, "E♭": 3, E: 4, Fb: 4, F: 5, "E#": 5, "F#": 6, "F♯": 6, Gb: 6,
  "G♭": 6, G: 7, "G#": 8, "G♯": 8, Ab: 8, "A♭": 8, A: 9, "A#": 10,
  "A♯": 10, Bb: 10, "B♭": 10, B: 11, Cb: 11,
};

export function pitchClass(value: string | null | undefined): number | null {
  if (!value) return null;
  const root = /^([A-G](?:#|b|♯|♭)?)/.exec(value.trim())?.[1];
  return root === undefined ? null : aliases[root] ?? null;
}

export function transposeForTargetKey(sourceKey: string | null | undefined, targetKey: string): number | null {
  const source = pitchClass(sourceKey);
  const target = pitchClass(targetKey);
  if (source === null || target === null) return null;
  const upward = (target - source + 12) % 12;
  return upward > 6 ? upward - 12 : upward;
}

export function transposeChordSymbol(symbol: string, semitones: number): string {
  const match = /^([A-G](?:#|b|♯|♭)?)(.*)$/.exec(symbol);
  if (!match) return symbol;
  const root = aliases[match[1]];
  if (root === undefined) return symbol;
  return `${pitchClasses[(root + semitones % 12 + 12) % 12]}${match[2]}`;
}

export function mapAlignmentToLearningTime(alignment: LyricAlignment, notes: readonly LearningVocalNote[]): LyricAlignment {
  const copy = structuredClone(alignment);
  const map = (seconds: number): number => learningTimeFromOriginalTime(seconds, notes);
  for (const line of copy.lines) {
    line.startSeconds = map(line.startSeconds);
    line.endSeconds = map(line.endSeconds);
    for (const word of line.words) {
      word.startSeconds = map(word.startSeconds);
      word.endSeconds = map(word.endSeconds);
      for (const syllable of word.syllables) {
        syllable.startSeconds = map(syllable.startSeconds);
        syllable.endSeconds = map(syllable.endSeconds);
      }
    }
  }
  return copy;
}

export function createBasicLyricsAlignment(authoritativeText: string, durationSeconds: number): LyricAlignment {
  const text = authoritativeText.replace(/\r\n/g, "\n").trim();
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const duration = Math.max(lines.length, Number.isFinite(durationSeconds) ? durationSeconds : lines.length * 4);
  return {
    version: 1,
    authoritativeText: text,
    source: "deterministic-review",
    confidence: "review",
    lines: lines.map((lineText, lineIndex) => {
      const startSeconds = lineIndex / lines.length * duration;
      const endSeconds = (lineIndex + 1) / lines.length * duration;
      const tokens = lineText.split(/\s+/).filter(Boolean);
      return {
        id: `basic-line-${lineIndex}`,
        text: lineText,
        startSeconds,
        endSeconds,
        words: tokens.map((wordText, wordIndex) => {
          const wordStart = startSeconds + wordIndex / tokens.length * (endSeconds - startSeconds);
          const wordEnd = startSeconds + (wordIndex + 1) / tokens.length * (endSeconds - startSeconds);
          const syllableTexts = splitSyllables(wordText);
          return {
            id: `basic-line-${lineIndex}-word-${wordIndex}`,
            text: wordText,
            startSeconds: wordStart,
            endSeconds: wordEnd,
            syllables: syllableTexts.map((syllableText, syllableIndex) => ({
              id: `basic-line-${lineIndex}-word-${wordIndex}-syllable-${syllableIndex}`,
              text: syllableText,
              startSeconds: wordStart + syllableIndex / syllableTexts.length * (wordEnd - wordStart),
              endSeconds: wordStart + (syllableIndex + 1) / syllableTexts.length * (wordEnd - wordStart),
              noteIds: [],
            })),
          };
        }),
      };
    }),
  };
}

export function editChordTiming(chords: readonly KaraokeChord[], id: string, startSeconds: number, endSeconds: number): KaraokeChord[] {
  return chords.map((chord) => chord.id === id ? { ...chord, startSeconds, endSeconds, source: "manual" } : { ...chord });
}
