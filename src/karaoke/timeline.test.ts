import { describe, expect, it } from "vitest";
import type { KaraokeChord, VocalMidiDiagnostics } from "./contracts";
import { alignLyricsToNotes } from "./lyrics-alignment";
import { resolveMelodySource, notPreparedMelody } from "./melody-source";
import { canonicalSecondsFor, lineAt, noteAt, notesForSyllable, resolveTimeline, type TimelineInput } from "./timeline";
import { createContinuousLearningNotes, createLearningNotes } from "./vocal-midi";

const raw = (id: string, midi: number, startSeconds: number, durationSeconds: number) =>
  ({ id, midi, startSeconds, durationSeconds, velocity: .8, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: startSeconds });

/** Two short lines over six notes, with a deliberate two-second gap so "between lines" is testable. */
function fixture(): TimelineInput {
  const notes = createLearningNotes([raw("a", 60, 1, .5), raw("b", 62, 1.6, .5), raw("c", 64, 2.2, .5), raw("d", 65, 6, .5), raw("e", 67, 6.6, .5), raw("f", 69, 7.2, .5)]);
  const aligned = alignLyricsToNotes("mze da mta\nsheni guli", notes);
  const chords: KaraokeChord[] = [
    { id: "c0", symbol: "Am", startSeconds: 0, endSeconds: 4, wordId: aligned.alignment.lines[0].words[0].id, source: "analysis" },
    { id: "c1", symbol: "F", startSeconds: 4, endSeconds: 9, wordId: aligned.alignment.lines[1].words[0].id, source: "analysis" },
  ];
  return { alignment: aligned.alignment, originalNotes: aligned.notes, continuousNotes: createContinuousLearningNotes(aligned.notes, .03), chords };
}

describe("shared karaoke timeline", () => {
  it("resolves note, line, word, syllable and chord from one canonical time", () => {
    const input = fixture();
    const position = resolveTimeline(input, 1.2);
    expect(position.note?.midi).toBe(60);
    expect(position.learningId).toBe(position.note?.learningId);
    expect(position.line?.id).toBe(input.alignment.lines[0].id);
    expect(position.word).not.toBeNull();
    expect(position.syllable).not.toBeNull();
    expect(position.chords.map((chord) => chord.symbol)).toEqual(["Am"]);
    expect(position.nextNote?.midi).toBe(62);
  });

  it("keeps a line on screen before, between and after the sung material", () => {
    const input = fixture();
    // Before the first line starts, the upcoming line is shown rather than nothing.
    expect(lineAt(input.alignment, 0.2)?.id).toBe(input.alignment.lines[0].id);
    // Inside a line but between two of its words: the line stays, the word highlight clears.
    const gap = resolveTimeline(input, 4);
    expect(gap.line?.id).toBe(input.alignment.lines[0].id);
    expect(gap.word).toBeNull();
    expect(gap.note).toBeNull();
    // Past the end of the song the last line stays on screen.
    expect(lineAt(input.alignment, 999)?.id).toBe(input.alignment.lines[1].id);
  });

  it("reports continuous study time alongside canonical time", () => {
    const input = fixture();
    // The first note starts one second into the MP3 but at zero in continuous study time.
    expect(resolveTimeline(input, 1).learningSeconds).toBeCloseTo(0, 5);
    expect(resolveTimeline(input, 1).canonicalSeconds).toBe(1);
    expect(resolveTimeline(input, 6).learningSeconds).toBeLessThan(6);
  });

  it("never returns a negative canonical time", () => {
    expect(resolveTimeline(fixture(), -3).canonicalSeconds).toBe(0);
  });

  it("maps every clickable id back to canonical seconds", () => {
    const input = fixture();
    const line = input.alignment.lines[1];
    const word = line.words[0];
    const syllable = word.syllables[0];
    expect(canonicalSecondsFor(input, { type: "line", id: line.id })).toBe(line.startSeconds);
    expect(canonicalSecondsFor(input, { type: "word", id: word.id })).toBe(word.startSeconds);
    expect(canonicalSecondsFor(input, { type: "syllable", id: syllable.id })).toBe(syllable.startSeconds);
    expect(canonicalSecondsFor(input, { type: "chord", id: "c1" })).toBe(4);
    expect(canonicalSecondsFor(input, { type: "note", id: input.originalNotes[3].learningId })).toBe(6);
  });

  it("returns null for an unknown id instead of seeking to zero", () => {
    expect(canonicalSecondsFor(fixture(), { type: "word", id: "no-such-word" })).toBeNull();
  });

  it("seeking to a word lands on that word and its line", () => {
    const input = fixture();
    const word = input.alignment.lines[1].words[0];
    const seconds = canonicalSecondsFor(input, { type: "word", id: word.id })!;
    const position = resolveTimeline(input, seconds + .01);
    expect(position.word?.id).toBe(word.id);
    expect(position.line?.id).toBe(input.alignment.lines[1].id);
  });

  it("exposes every note carrying one syllable, so a melisma stays visible", () => {
    const input = fixture();
    const syllable = input.alignment.lines[0].words[0].syllables[0];
    const notes = notesForSyllable(input, syllable.id);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every((note) => note.syllableId === syllable.id)).toBe(true);
  });

  it("finds no note in a silent stretch", () => {
    expect(noteAt(fixture().originalNotes, 4.5)).toBeNull();
  });
});

const diagnostics = (status: VocalMidiDiagnostics["status"], pitchConfidence = .8): VocalMidiDiagnostics =>
  ({ noteCount: 20, pitchMin: 55, pitchMax: 72, medianNoteDurationMs: 300, shortNoteRejectionCount: 2, octaveCorrectionCount: 0, longestSilenceMs: 900, pitchConfidence, monophonyRatio: 1, status });

describe("melody source priority", () => {
  it("prefers a manually approved melody over everything else", () => {
    const resolved = resolveMelodySource([
      { lane: "manual", available: true, noteCount: 12 },
      { lane: "mp3-vocal", available: true, noteCount: 40, diagnostics: diagnostics("verified") },
      { lane: "vocal-midi", available: true, noteCount: 30 },
    ]);
    expect(resolved.lane).toBe("manual");
    expect(resolved.confidence).toBe("verified");
  });

  it("prefers a high-confidence extraction over an explicit MIDI", () => {
    const resolved = resolveMelodySource([
      { lane: "mp3-vocal", available: true, noteCount: 40, diagnostics: diagnostics("verified") },
      { lane: "vocal-midi", available: true, noteCount: 30 },
    ]);
    expect(resolved.lane).toBe("mp3-vocal");
  });

  it("lets an explicit MIDI outrank an extraction the diagnostics do not trust", () => {
    const resolved = resolveMelodySource([
      { lane: "mp3-vocal", available: true, noteCount: 40, diagnostics: diagnostics("review") },
      { lane: "vocal-midi", available: true, noteCount: 30, label: "melody.mid" },
    ]);
    expect(resolved.lane).toBe("vocal-midi");
    expect(resolved.label).toBe("melody.mid");
  });

  it("still uses a review-grade extraction when it is the only real melody", () => {
    const resolved = resolveMelodySource([
      { lane: "mp3-vocal", available: true, noteCount: 40, diagnostics: diagnostics("review", .41) },
      { lane: "inferred", available: true, noteCount: 8 },
    ]);
    expect(resolved.lane).toBe("mp3-vocal");
    expect(resolved.confidence).toBe("review");
    expect(resolved.reason).toContain("0.41");
  });

  it("falls back to inference, then to not prepared", () => {
    expect(resolveMelodySource([{ lane: "inferred", available: true, noteCount: 5 }]).confidence).toBe("inferred");
    expect(resolveMelodySource([{ lane: "mp3-vocal", available: true, noteCount: 0, diagnostics: diagnostics("review") }])).toEqual(notPreparedMelody);
    expect(resolveMelodySource([])).toEqual(notPreparedMelody);
  });

  it("is deterministic, so a lane cannot change between two resolutions", () => {
    const candidates = [
      { lane: "mp3-vocal" as const, available: true, noteCount: 40, diagnostics: diagnostics("verified") },
      { lane: "vocal-midi" as const, available: true, noteCount: 30 },
    ];
    expect(resolveMelodySource(candidates)).toEqual(resolveMelodySource([...candidates].reverse()));
  });
});
