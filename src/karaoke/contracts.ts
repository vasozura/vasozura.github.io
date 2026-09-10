export type KaraokeConfidence = "verified" | "review" | "inferred";
export type KaraokeLyricMode = "off" | "line" | "word" | "syllable";
export type KaraokeAudioMode = "original" | "instrumental" | "guide";
export type KaraokeGuide = "off" | "piano" | "guitar";

export interface ExtractedVocalNote {
  id: string;
  midi: number;
  startSeconds: number;
  durationSeconds: number;
  velocity: number;
  confidence: number;
  pitchConfidence: number;
  sourceTimestampSeconds: number;
}

export interface LearningVocalNote extends ExtractedVocalNote {
  learningId: string;
  originalStartSeconds: number;
  originalDurationSeconds: number;
  lyricLineId: string | null;
  wordId: string | null;
  syllableId: string | null;
  provenance: string;
}

export interface LyricSyllable {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  noteIds: string[];
}

export interface LyricWord {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  syllables: LyricSyllable[];
}

export interface LyricLine {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  words: LyricWord[];
}

export interface LyricAlignment {
  version: 1;
  authoritativeText: string;
  source: "musicxml" | "midi" | "forced-alignment" | "deterministic-review" | "manual";
  confidence: KaraokeConfidence;
  lines: LyricLine[];
}

export interface KaraokeChord {
  id: string;
  symbol: string;
  startSeconds: number;
  endSeconds: number;
  wordId: string | null;
  source: "musicxml" | "midi" | "analysis" | "manual";
}

export interface VocalMidiDiagnostics {
  noteCount: number;
  pitchMin: number | null;
  pitchMax: number | null;
  medianNoteDurationMs: number;
  shortNoteRejectionCount: number;
  octaveCorrectionCount: number;
  longestSilenceMs: number;
  pitchConfidence: number;
  monophonyRatio: number;
  status: "verified" | "review";
}

/** One key per generated artifact. The browser lists these generically, so adding a key adds a
 *  download link without any UI change. 16:9 keeps the unsuffixed key it has always used. */
export type KaraokeExportKey =
  | "vocalMidi" | "learningMidi" | "lyricsMidi" | "chordMidi" | "studyMidi"
  | "lrc" | "srt" | "chordedText"
  | "ass" | "assShorts" | "assSquare"
  | "mp4" | "mp4Shorts" | "mp4Square"
  | "guideAudio" | "mp4Guide" | "mp4GuideShorts" | "mp4GuideSquare";

export interface KaraokeArtifactManifest {
  version: 1;
  songId: string;
  slug: string;
  generatedAt: string;
  sourceAudioSha256: string;
  melodySource: string;
  sourceConfidence: KaraokeConfidence;
  audio: {
    originalUrl: string | null;
    instrumentalUrl: string | null;
    vocalUrl: string | null;
  };
  originalNotes: LearningVocalNote[];
  continuousNotes: LearningVocalNote[];
  alignment: LyricAlignment;
  chords: KaraokeChord[];
  diagnostics: VocalMidiDiagnostics;
  exports: Partial<Record<KaraokeExportKey, string>>;
}

export interface KaraokeRenderManifest {
  version: 1;
  preset: "youtube-16:9" | "shorts-9:16" | "square-1:1";
  width: number;
  height: number;
  safeMargin: number;
  background: { kind: "image" | "video" | "cover-blur" | "dark-gradient"; source: string | null };
  audio: { kind: "original" | "instrumental" | "instrumental-guide"; source: string; guide?: "piano" | "guitar" };
  subtitles: { source: string; format: "ass" };
  durationSeconds: number;
}
