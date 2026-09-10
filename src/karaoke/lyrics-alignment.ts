import type { KaraokeChord, LearningVocalNote, LyricAlignment, LyricLine, LyricSyllable, LyricWord } from "./contracts";

const wordTokens = (line: string): string[] => line.match(/[\p{L}\p{N}’'\-]+|[^\s\p{L}\p{N}]+/gu)?.filter((token) => /[\p{L}\p{N}]/u.test(token)) ?? [];
const vowels = /[aeiouyაეიოუ]/iu;

export function splitSyllables(word: string): string[] {
  if (word.includes("-")) return word.split("-").filter(Boolean);
  const characters = [...word];
  if (characters.length < 4) return [word];
  const result: string[] = [];
  let current = "";
  for (let index = 0; index < characters.length; index += 1) {
    current += characters[index];
    const next = characters[index + 1];
    if (vowels.test(characters[index]) && next && (vowels.test(next) || (characters[index + 2] && vowels.test(characters[index + 2])))) {
      result.push(current);
      current = "";
    }
  }
  if (current) result.push(current);
  return result.length ? result : [word];
}

function allocate(items: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const result = weights.map(() => 0);
  for (let index = 0; index < items; index += 1) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const targets = weights.map((weight, cursor) => weight / total * items - result[cursor]);
    const winner = targets.indexOf(Math.max(...targets));
    result[winner] += 1;
  }
  return result;
}

export function alignLyricsToNotes(authoritativeText: string, notesInput: readonly LearningVocalNote[], source: LyricAlignment["source"] = "deterministic-review"): { alignment: LyricAlignment; notes: LearningVocalNote[] } {
  const text = authoritativeText.replace(/\r\n/g, "\n").trim();
  const lineTexts = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const noteSequence = notesInput.map((note) => ({ ...note })).sort((a, b) => a.originalStartSeconds - b.originalStartSeconds);
  const lineWeights = lineTexts.map((line) => Math.max(1, wordTokens(line).length));
  const lineAllocations = allocate(noteSequence.length, lineWeights);
  const lines: LyricLine[] = [];
  let cursor = 0;
  lineTexts.forEach((lineText, lineIndex) => {
    const lineNotes = noteSequence.slice(cursor, cursor + lineAllocations[lineIndex]);
    cursor += lineNotes.length;
    const tokens = wordTokens(lineText);
    const wordAllocations = allocate(lineNotes.length, tokens.map((token) => Math.max(1, [...token].length)));
    const words: LyricWord[] = [];
    let noteCursor = 0;
    tokens.forEach((textValue, wordIndex) => {
      const assigned = lineNotes.slice(noteCursor, noteCursor + wordAllocations[wordIndex]);
      noteCursor += assigned.length;
      const syllableTexts = splitSyllables(textValue);
      const syllableAllocations = allocate(assigned.length, syllableTexts.map((item) => Math.max(1, [...item].length)));
      const syllables: LyricSyllable[] = [];
      let syllableCursor = 0;
      syllableTexts.forEach((syllableText, syllableIndex) => {
        const syllableNotes = assigned.slice(syllableCursor, syllableCursor + syllableAllocations[syllableIndex]);
        syllableCursor += syllableNotes.length;
        const first = syllableNotes[0] ?? assigned[0] ?? lineNotes[0];
        const last = syllableNotes.at(-1) ?? first;
        const syllableId = `line-${lineIndex}-word-${wordIndex}-syllable-${syllableIndex}`;
        syllableNotes.forEach((note) => { note.syllableId = syllableId; });
        syllables.push({ id: syllableId, text: syllableText, startSeconds: first?.originalStartSeconds ?? 0, endSeconds: last ? last.originalStartSeconds + last.originalDurationSeconds : 0, noteIds: syllableNotes.map((note) => note.learningId) });
      });
      const first = assigned[0] ?? lineNotes[0];
      const last = assigned.at(-1) ?? first;
      const wordId = `line-${lineIndex}-word-${wordIndex}`;
      assigned.forEach((note) => { note.wordId = wordId; });
      words.push({ id: wordId, text: textValue, startSeconds: first?.originalStartSeconds ?? 0, endSeconds: last ? last.originalStartSeconds + last.originalDurationSeconds : 0, syllables });
    });
    const first = lineNotes[0];
    const last = lineNotes.at(-1);
    const lineId = `line-${lineIndex}`;
    lineNotes.forEach((note) => { note.lyricLineId = lineId; });
    lines.push({ id: lineId, text: lineText, startSeconds: first?.originalStartSeconds ?? 0, endSeconds: last ? last.originalStartSeconds + last.originalDurationSeconds : 0, words });
  });
  return { alignment: { version: 1, authoritativeText: text, source, confidence: source === "manual" || source === "musicxml" ? "verified" : "review", lines }, notes: noteSequence };
}

export function attachChordsToLyrics(chords: readonly Omit<KaraokeChord, "wordId">[], alignment: LyricAlignment): KaraokeChord[] {
  const words = alignment.lines.flatMap((line) => line.words);
  return chords.map((chord) => {
    const nearest = [...words].sort((a, b) => Math.abs(a.startSeconds - chord.startSeconds) - Math.abs(b.startSeconds - chord.startSeconds))[0];
    return { ...chord, wordId: nearest?.id ?? null };
  });
}

export interface TimingEdit { type: "line" | "word" | "syllable" | "chord"; id: string; startSeconds: number; endSeconds?: number; }

export function applyTimingEdits(alignment: LyricAlignment, edits: readonly TimingEdit[]): LyricAlignment {
  const copy = structuredClone(alignment);
  const editById = new Map(edits.map((edit) => [edit.id, edit]));
  for (const line of copy.lines) {
    const lineEdit = editById.get(line.id);
    if (lineEdit) { line.startSeconds = lineEdit.startSeconds; line.endSeconds = lineEdit.endSeconds ?? line.endSeconds; }
    for (const word of line.words) {
      const wordEdit = editById.get(word.id);
      if (wordEdit) { word.startSeconds = wordEdit.startSeconds; word.endSeconds = wordEdit.endSeconds ?? word.endSeconds; }
      for (const syllable of word.syllables) {
        const syllableEdit = editById.get(syllable.id);
        if (syllableEdit) { syllable.startSeconds = syllableEdit.startSeconds; syllable.endSeconds = syllableEdit.endSeconds ?? syllable.endSeconds; }
      }
    }
  }
  copy.source = "manual";
  copy.confidence = "verified";
  return copy;
}
