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
  /** Where this line came from. `canonical` is the authored song text; `performance` is something
   *  sung in this particular recording - an intro phrase, an ad-lib, a repeat - that is not part of
   *  the authored poem. A performance line is timed and highlighted like any other, but it is never
   *  written back into the song's lyrics. Absent means canonical. */
  origin?: "canonical" | "performance";
  /** Set on a performance line whose wording could not be established from the recording. The line
   *  still carries real timing; only its text is a placeholder awaiting the owner. */
  needsOwnerConfirmation?: boolean;
}

export interface LyricAlignment {
  version: 1;
  /** The authored song text, exactly as the song record holds it. Performance-only lines are never
   *  added here: `lines` may contain more than this text does, never the other way round. */
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

/** Which lane the study melody was taken from. The order here is the resolution priority:
 *  a manually approved melody always wins, an inferred one is the last resort. */
export type KaraokeMelodyLane = "manual" | "mp3-vocal" | "vocal-midi" | "inferred";

export interface KaraokeMelodySource {
  lane: KaraokeMelodyLane;
  /** Human label; the same string the browser has always shown as "Melody source". */
  label: string;
  confidence: KaraokeConfidence;
  /** Why this lane won, so a reviewer can see the decision without rerunning it. */
  reason: string;
}

/** What the browser needs to offer Piano/Guitar guide playback, and which guide (if any) was
 *  baked into an offline mix. */
export interface KaraokeGuideInfo {
  /** Guide instruments the browser can play from the prepared melody. */
  instruments: Array<"piano" | "guitar">;
  /** Instrument of the rendered `instrumental + guide` audio, when one was generated. */
  renderedInstrument: "piano" | "guitar" | null;
  audioUrl: string | null;
}

/** One generated video, described well enough to reproduce or audit it without the render file. */
export interface KaraokeRenderSummary {
  preset: KaraokeRenderManifest["preset"];
  width: number;
  height: number;
  background: KaraokeRenderManifest["background"]["kind"];
  audio: KaraokeRenderManifest["audio"]["kind"];
  guide: "piano" | "guitar" | null;
  exportKey: KaraokeExportKey;
  file: string;
}

/** How the artifacts were produced. `stemSeparation: false` means pitch tracking ran on the
 *  canonical mix, which is supported but always review-grade. */
export interface KaraokeProvenance {
  tool: string;
  analysis: string;
  stemSeparation: boolean;
  lyricsSource: "song.lyrics";
  status: "verified" | "review";
  notes: string | null;
}

/** The one shared timeline. Canonical MP3 seconds are the reference clock; continuous study time
 *  is derived from it by originalTimeFromLearningTime/learningTimeFromOriginalTime. */
export interface KaraokeTimelineInfo {
  canonicalDurationSeconds: number | null;
  maxInternalSilenceMs: number;
}

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
  /* Everything below is written by every current preparation run and is optional only so that
     manifests generated before these fields existed still load. The browser must treat an absent
     field as "not prepared", never as an error. */
  melody?: KaraokeMelodySource;
  guide?: KaraokeGuideInfo;
  renders?: KaraokeRenderSummary[];
  provenance?: KaraokeProvenance;
  timeline?: KaraokeTimelineInfo;
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
