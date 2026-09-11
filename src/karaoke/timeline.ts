import type { KaraokeChord, LearningVocalNote, LyricAlignment, LyricLine, LyricSyllable, LyricWord } from "./contracts";
import { learningTimeFromOriginalTime } from "./vocal-midi";

/** The one shared timeline.
 *
 * Canonical MP3 seconds are the reference clock. Everything else - the note the visualizer paints,
 * the highlighted line, word and syllable, the chord above the lyric, and continuous study time -
 * is resolved from that single number here, so a seek from any view lands every other view on the
 * same instant. Views must not keep their own idea of "where we are". */

export interface TimelinePosition {
  canonicalSeconds: number;
  /** Continuous study time, interpolated from the continuous melody. */
  learningSeconds: number;
  /** The line being sung now. Null during an instrumental passage - see `isInstrumental`. */
  line: LyricLine | null;
  /** Shown subdued before it starts; never highlighted as active. */
  upcomingLine: LyricLine | null;
  previousLine: LyricLine | null;
  /** True when nobody is singing: no line, word, syllable or lyric highlight belongs on screen. */
  isInstrumental: boolean;
  word: LyricWord | null;
  syllable: LyricSyllable | null;
  note: LearningVocalNote | null;
  nextNote: LearningVocalNote | null;
  chords: KaraokeChord[];
  /** Identifier of the active melody note, the key the Learning Marker and exercises share. */
  learningId: string | null;
}

export interface TimelineInput {
  alignment: LyricAlignment;
  originalNotes: readonly LearningVocalNote[];
  continuousNotes?: readonly LearningVocalNote[];
  chords?: readonly KaraokeChord[];
}

const within = (start: number, end: number, time: number): boolean => start <= time && end > time;

export function noteAt(notes: readonly LearningVocalNote[], canonicalSeconds: number): LearningVocalNote | null {
  return notes.find((note) => within(note.originalStartSeconds, note.originalStartSeconds + note.originalDurationSeconds, canonicalSeconds)) ?? null;
}

/** The line being sung at this instant, or null.
 *
 * Null is a real answer, not a gap to paper over: during an instrumental introduction, a solo or the
 * rest between two verses nobody is singing, and nothing may be highlighted as if they were. The
 * upcoming line is reported separately so the stage can show it, subdued, without ever marking it
 * active before its own start time. */
export function lineAt(alignment: LyricAlignment, canonicalSeconds: number): LyricLine | null {
  return alignment.lines.find((line) => within(line.startSeconds, line.endSeconds, canonicalSeconds)) ?? null;
}

/** The next line that will be sung, for the subdued preview. */
export function upcomingLineAt(alignment: LyricAlignment, canonicalSeconds: number): LyricLine | null {
  return alignment.lines.find((line) => line.startSeconds > canonicalSeconds) ?? null;
}

/** The line most recently finished, for the subdued trail behind the active one. */
export function previousLineAt(alignment: LyricAlignment, canonicalSeconds: number): LyricLine | null {
  let found: LyricLine | null = null;
  for (const line of alignment.lines) {
    if (line.endSeconds <= canonicalSeconds) found = line;
    else if (line.startSeconds <= canonicalSeconds) return found;
  }
  return found;
}

export function resolveTimeline(input: TimelineInput, canonicalSeconds: number): TimelinePosition {
  const time = Math.max(0, canonicalSeconds);
  const note = noteAt(input.originalNotes, time);
  const index = note ? input.originalNotes.findIndex((item) => item.learningId === note.learningId) : -1;
  const nextNote = (index >= 0 ? input.originalNotes[index + 1] : input.originalNotes.find((item) => item.originalStartSeconds > time)) ?? null;
  const line = lineAt(input.alignment, time);
  const word = line?.words.find((item) => within(item.startSeconds, item.endSeconds, time)) ?? null;
  const syllable = word?.syllables.find((item) => within(item.startSeconds, item.endSeconds, time)) ?? null;
  return {
    canonicalSeconds: time,
    learningSeconds: input.continuousNotes?.length ? learningTimeFromOriginalTime(time, input.continuousNotes) : time,
    line,
    upcomingLine: upcomingLineAt(input.alignment, time),
    previousLine: previousLineAt(input.alignment, time),
    isInstrumental: line === null,
    word, syllable, note, nextNote,
    chords: (input.chords ?? []).filter((chord) => within(chord.startSeconds, chord.endSeconds, time)),
    learningId: note?.learningId ?? null,
  };
}

export type TimelineAnchor = { type: "line" | "word" | "syllable"; id: string } | { type: "note"; id: string } | { type: "chord"; id: string };

/** Canonical MP3 seconds for anything the student can click. Returns null for an unknown id, so a
 *  caller never seeks to an accidental zero. */
export function canonicalSecondsFor(input: TimelineInput, anchor: TimelineAnchor): number | null {
  if (anchor.type === "note") return input.originalNotes.find((note) => note.learningId === anchor.id)?.originalStartSeconds ?? null;
  if (anchor.type === "chord") return input.chords?.find((chord) => chord.id === anchor.id)?.startSeconds ?? null;
  for (const line of input.alignment.lines) {
    if (anchor.type === "line" && line.id === anchor.id) return line.startSeconds;
    for (const word of line.words) {
      if (anchor.type === "word" && word.id === anchor.id) return word.startSeconds;
      const syllable = word.syllables.find((item) => anchor.type === "syllable" && item.id === anchor.id);
      if (syllable) return syllable.startSeconds;
    }
  }
  return null;
}

/** Melody notes carrying one syllable, in order. A melisma is simply more than one. */
export function notesForSyllable(input: TimelineInput, syllableId: string): LearningVocalNote[] {
  return input.originalNotes.filter((note) => note.syllableId === syllableId);
}
