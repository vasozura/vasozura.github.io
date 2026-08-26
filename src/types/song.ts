export interface LocalizedText {
  ka: string | null;
  en: string | null;
}

export type PublicationStatus = "draft" | "published" | "archived" | null;

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
  lyrics: LocalizedText | null;
  sunoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  durationSeconds: number | null;
  bpm: number | null;
  musicalKey: string | null;
  timeSignature: string | null;
  difficulty: string | null;
  publicationStatus: PublicationStatus;
  publicationDate: string | null;
}
