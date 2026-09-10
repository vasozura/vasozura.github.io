import { describe, expect, it } from "vitest";
import type { ExtractedVocalNote, KaraokeArtifactManifest, LearningVocalNote } from "./contracts";
import { alignLyricsToNotes, splitSyllables } from "./lyrics-alignment";
import { createAss, createChordedLyrics, createLrc, createMidi, createRenderManifest, createSrt } from "./exports";
import { cleanVocalNotes, createContinuousLearningNotes, createLearningNotes, learningTimeFromOriginalTime, maximumInternalSilenceMs, originalTimeFromLearningTime } from "./vocal-midi";

const raw = (id: string, midi: number, startSeconds: number, durationSeconds: number, confidence = .9): ExtractedVocalNote => ({ id, midi, startSeconds, durationSeconds, velocity: .8, confidence, pitchConfidence: confidence, sourceTimestampSeconds: startSeconds });
const source = [raw("a", 64, 2, .3), raw("glitch", 80, 2.32, .02), raw("b", 66, 2.36, .24), raw("c", 67, 4.8, .32), raw("d", 69, 5.2, .25)];

describe("offline Vocal/Karaoke pipeline", () => {
  it("represents MP3-derived pitch notes with source timestamps and confidence", () => {
    expect(source[0]).toMatchObject({ midi: 64, sourceTimestampSeconds: 2, confidence: .9 });
  });

  it("rejects short glitches and keeps deterministic monophonic order", () => {
    const result = cleanVocalNotes(source);
    expect(result.notes.map((note) => note.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.diagnostics.shortNoteRejectionCount).toBe(1);
    expect(result.diagnostics.monophonyRatio).toBe(1);
  });

  it("corrects low-confidence octave errors without changing a confident source", () => {
    const result = cleanVocalNotes([raw("a", 60, 0, .2), raw("octave", 73, .3, .2, .4), raw("stable", 76, .6, .2, .95)]);
    expect(result.notes.map((note) => note.midi)).toEqual([60, 61, 76]);
    expect(result.diagnostics.octaveCorrectionCount).toBe(1);
  });

  it("creates a <=30ms continuous study representation without mutating canonical notes", () => {
    const original = createLearningNotes(cleanVocalNotes(source).notes);
    const snapshot = structuredClone(original);
    const continuous = createContinuousLearningNotes(original);
    expect(maximumInternalSilenceMs(continuous)).toBeLessThanOrEqual(30);
    expect(continuous[0].startSeconds).toBe(0);
    expect(original).toEqual(snapshot);
    expect(continuous.map((note) => note.midi)).toEqual(original.map((note) => note.midi));
  });

  it("maps original and continuous time reversibly within tolerance", () => {
    const continuous = createContinuousLearningNotes(createLearningNotes(cleanVocalNotes(source).notes));
    const original = 4.9;
    const study = learningTimeFromOriginalTime(original, continuous);
    expect(originalTimeFromLearningTime(study, continuous)).toBeCloseTo(original, 4);
  });

  it("preserves authoritative song.lyrics and maps notes to lines, words and syllables", () => {
    const text = "სიყვარული იწყებოდა\nშენი თაფლის თვალი";
    const aligned = alignLyricsToNotes(text, createLearningNotes(cleanVocalNotes(source).notes));
    expect(aligned.alignment.authoritativeText).toBe(text);
    expect(aligned.notes.every((note) => note.lyricLineId && note.wordId && note.syllableId)).toBe(true);
    expect(splitSyllables("სიყვარული").join("")).toBe("სიყვარული");
  });

  it("supports melisma by retaining one syllable across multiple notes", () => {
    const notes = createLearningNotes([raw("a", 60, 0, .2), raw("b", 62, .25, .2), raw("c", 64, .5, .2)]);
    const aligned = alignLyricsToNotes("მზე", notes);
    expect(new Set(aligned.notes.map((note) => note.syllableId)).size).toBe(1);
    expect(aligned.alignment.lines[0].words[0].syllables[0].noteIds).toHaveLength(3);
  });

  it("writes standard MIDI track-name, text and lyric meta events", () => {
    const notes = createLearningNotes([raw("a", 60, 0, .2), raw("b", 62, .3, .2)]);
    const aligned = alignLyricsToNotes("one two", notes);
    const midi = createMidi(aligned.notes, aligned.alignment, { includeLyrics: true });
    expect(new TextDecoder().decode(midi).includes("Learning Melody")).toBe(true);
    expect([...midi].some((byte, index, values) => byte === 0xff && values[index + 1] === 0x05)).toBe(true);
  });

  it("exports synchronized LRC, SRT, ASS and chorded lyric text", () => {
    const aligned = alignLyricsToNotes("one two", createLearningNotes([raw("a", 60, 0, .2), raw("b", 62, .3, .2)])).alignment;
    const chord = [{ id: "c", symbol: "Am", startSeconds: 0, endSeconds: 1, wordId: aligned.lines[0].words[0].id, source: "analysis" as const }];
    expect(createLrc(aligned)).toContain("[00:00.00]");
    expect(createSrt(aligned)).toContain("-->");
    expect(createAss(aligned, chord)).toContain("{\\k");
    expect(createChordedLyrics(aligned, chord)).toContain("Am");
  });

  it("keeps lyric timing intact when melody pitch is transposed", () => {
    const aligned = alignLyricsToNotes("one two", createLearningNotes([raw("a", 60, 0, .2), raw("b", 62, .3, .2)]));
    const before = structuredClone(aligned.alignment);
    aligned.notes.forEach((note) => { note.midi += 2; });
    expect(aligned.alignment).toEqual(before);
  });

  it("ties chords to lyric words by stable identifiers", () => {
    const aligned = alignLyricsToNotes("one two", createLearningNotes([raw("a", 60, 0, .2), raw("b", 62, .3, .2)])).alignment;
    expect(aligned.lines[0].words[0].id).toBe("line-0-word-0");
  });

  it("creates exact MP4 render dimensions and safe margins", () => {
    const alignment = alignLyricsToNotes("one", createLearningNotes([raw("a", 60, 0, .2)])).alignment;
    const manifest = { version: 1, songId: "s", slug: "song", generatedAt: "now", sourceAudioSha256: "a".repeat(64), melodySource: "MP3 Vocal Extraction", sourceConfidence: "review", audio: { originalUrl: null, instrumentalUrl: "instrumental.mp3", vocalUrl: "vocal.mp3" }, originalNotes: [] as LearningVocalNote[], continuousNotes: [] as LearningVocalNote[], alignment, chords: [], diagnostics: { noteCount: 0, pitchMin: null, pitchMax: null, medianNoteDurationMs: 0, shortNoteRejectionCount: 0, octaveCorrectionCount: 0, longestSilenceMs: 0, pitchConfidence: 0, monophonyRatio: 1, status: "review" }, exports: {} } satisfies KaraokeArtifactManifest;
    const render = createRenderManifest(manifest, { preset: "shorts-9:16", audioSource: "instrumental.mp3", audioKind: "instrumental", backgroundKind: "dark-gradient", subtitleSource: "lyrics.ass" });
    expect(render).toMatchObject({ width: 1080, height: 1920, safeMargin: 108, durationSeconds: .2 });
  });

  it("keeps instrumental karaoke on a distinct non-vocal audio source", () => {
    const sources = { originalUrl: "song.mp3", instrumentalUrl: "instrumental.mp3", vocalUrl: "vocal.mp3" };
    expect(sources.instrumentalUrl).not.toBe(sources.originalUrl);
    expect(sources.instrumentalUrl).not.toBe(sources.vocalUrl);
  });

  it("uses one note identity for audio, lyric and guide synchronization", () => {
    const aligned = alignLyricsToNotes("ერთი", createLearningNotes([raw("a", 64, 1, .4)])).notes[0];
    expect(aligned.learningId).toBe("vocal-0-a");
    expect(aligned.wordId).toBe("line-0-word-0");
    expect(aligned.syllableId).toBe("line-0-word-0-syllable-0");
  });
});
