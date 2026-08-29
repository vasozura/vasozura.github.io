export interface LocalizedText {
  ka: string | null;
  en: string | null;
}

export type PublicationStatus = "draft" | "published";
export type Difficulty = "beginner" | "intermediate" | "advanced" | null;
export type Instrument = "piano" | "guitar" | "accordion";

export interface Song {
  id: string;
  slug: string;
  title: LocalizedText;
  displayCredit: LocalizedText | null;
  composer: LocalizedText | null;
  lyricistOrPoet: LocalizedText | null;
  translator: LocalizedText | null;
  language: string | null;
  description: LocalizedText | null;
  coverUrl: string | null;
  audioUrl: string | null;
  midiUrl: string | null;
  musicXmlUrl: string | null;
  scorePdfUrl: string | null;
  sourceProjectUrl: string | null;
  lyrics: LocalizedText | null;
  sunoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  durationSeconds: number | null;
  bpm: number | null;
  musicalKey: string | null;
  timeSignature: string | null;
  difficulty: Difficulty;
  publicationStatus: PublicationStatus;
  publicationDate: string | null;
  learningEnabled?: boolean;
  learningInstruments?: Instrument[];
  learningSource?: "musicxml" | "midi";
  learningMapping?: Record<string, unknown>;
  learningFingering?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SongFilters {
  query: string;
  language: string;
  lyricist: string;
  difficulty: string;
  resource: "" | "audio" | "midi" | "musicxml" | "score" | "lyrics";
}

export interface SongFileRecord {
  id: string;
  songId: string;
  fileType: string;
  storagePath: string;
  publicUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  version: number;
  createdAt: string;
}

export interface InstrumentPart {
  id: string;
  songId: string;
  instrument: Instrument;
  musicXmlUrl: string | null;
  midiUrl: string | null;
  fingeringJson: Record<string, unknown> | null;
  difficulty: Difficulty;
  notes: string | null;
}
