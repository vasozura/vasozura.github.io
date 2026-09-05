import { getSupabase, requireSupabase } from "../lib/supabase";
import type { Difficulty, LocalizedText, Song, SongFilters } from "../types/song";
import { fileRules, type UploadFileType } from "../utils/file-validation";
import { safeHttpUrl } from "../utils/safe-url";

type SongRow = Record<string, unknown>;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function localized(ka: unknown, en: unknown): LocalizedText | null {
  const value = { ka: stringOrNull(ka), en: stringOrNull(en) };
  return value.ka || value.en ? value : null;
}

export function songFromRow(row: SongRow): Song {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: { ka: stringOrNull(row.title_ka), en: stringOrNull(row.title_en) },
    displayCredit: localized(row.display_credit, row.display_credit),
    composer: localized(row.composer, row.composer),
    lyricistOrPoet: localized(row.lyricist, row.lyricist),
    translator: localized(row.translator, row.translator),
    language: stringOrNull(row.language),
    description: localized(row.description_ka, row.description_en),
    lyrics: localized(row.lyrics_ka, row.lyrics_en),
    coverUrl: safeHttpUrl(stringOrNull(row.cover_url)),
    audioUrl: safeHttpUrl(stringOrNull(row.audio_url)),
    midiUrl: safeHttpUrl(stringOrNull(row.midi_url)),
    musicXmlUrl: safeHttpUrl(stringOrNull(row.musicxml_url)),
    scorePdfUrl: safeHttpUrl(stringOrNull(row.score_pdf_url)),
    sourceProjectUrl: safeHttpUrl(stringOrNull(row.source_project_url)),
    sunoUrl: safeHttpUrl(stringOrNull(row.suno_url)),
    youtubeUrl: safeHttpUrl(stringOrNull(row.youtube_url)),
    youtubeVideoId: stringOrNull(row.youtube_video_id),
    durationSeconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    bpm: typeof row.bpm === "number" ? row.bpm : null,
    musicalKey: stringOrNull(row.musical_key),
    timeSignature: stringOrNull(row.time_signature),
    difficulty: ["beginner", "intermediate", "advanced"].includes(String(row.difficulty)) ? row.difficulty as Difficulty : null,
    publicationStatus: row.status === "published" ? "published" : "draft",
    publicationDate: stringOrNull(row.published_at),
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  };
}

export function songToRow(song: Song): Record<string, unknown> {
  return {
    id: /^[0-9a-f-]{36}$/i.test(song.id) ? song.id : undefined,
    slug: song.slug,
    status: song.publicationStatus,
    title_ka: song.title.ka,
    title_en: song.title.en,
    display_credit: song.displayCredit?.ka ?? song.displayCredit?.en,
    composer: song.composer?.ka ?? song.composer?.en,
    lyricist: song.lyricistOrPoet?.ka ?? song.lyricistOrPoet?.en,
    translator: song.translator?.ka ?? song.translator?.en,
    language: song.language,
    description_ka: song.description?.ka,
    description_en: song.description?.en,
    lyrics_ka: song.lyrics?.ka,
    lyrics_en: song.lyrics?.en,
    cover_url: song.coverUrl,
    audio_url: song.audioUrl,
    midi_url: song.midiUrl,
    musicxml_url: song.musicXmlUrl,
    score_pdf_url: song.scorePdfUrl,
    source_project_url: song.sourceProjectUrl,
    suno_url: song.sunoUrl,
    youtube_url: song.youtubeUrl,
    youtube_video_id: song.youtubeVideoId,
    duration_seconds: song.durationSeconds,
    bpm: song.bpm,
    musical_key: song.musicalKey,
    time_signature: song.timeSignature,
    difficulty: song.difficulty,
    published_at: song.publicationStatus === "published" ? song.publicationDate ?? new Date().toISOString() : null,
  };
}

const songSelect = "id,slug,status,title_ka,title_en,display_credit,composer,lyricist,translator,language,description_ka,description_en,lyrics_ka,lyrics_en,cover_url,audio_url,midi_url,musicxml_url,score_pdf_url,source_project_url,suno_url,youtube_url,youtube_video_id,duration_seconds,bpm,musical_key,time_signature,difficulty,published_at,created_at,updated_at";

async function hydrateLearningConfiguration(songs: Song[]): Promise<Song[]> {
  if (!songs.length) return songs;
  const { data, error } = await requireSupabase().from("songs").select("id,learning_enabled,learning_instruments,learning_source_type,learning_mapping,learning_fingering").in("id", songs.map((song) => song.id));
  if (error) return songs;
  const configs = new Map((data as SongRow[]).map((row) => [String(row.id), row]));
  return songs.map((song) => {
    const row = configs.get(song.id);
    if (!row) return song;
    return { ...song, learningEnabled: row.learning_enabled === true, learningInstruments: Array.isArray(row.learning_instruments) ? row.learning_instruments.filter((entry): entry is "piano" | "guitar" | "accordion" => ["piano", "guitar", "accordion"].includes(String(entry))) : [], learningSource: row.learning_source_type === "midi" ? "midi" : "musicxml", learningMapping: row.learning_mapping && typeof row.learning_mapping === "object" ? row.learning_mapping as Record<string, unknown> : {}, learningFingering: row.learning_fingering && typeof row.learning_fingering === "object" ? row.learning_fingering as Record<string, unknown> : {} };
  });
}

const resourceProperties: Partial<Record<UploadFileType, keyof Pick<Song, "coverUrl" | "audioUrl" | "midiUrl" | "musicXmlUrl" | "scorePdfUrl" | "sourceProjectUrl">>> = {
  cover: "coverUrl",
  audio: "audioUrl",
  midi: "midiUrl",
  musicxml: "musicXmlUrl",
  score_pdf: "scorePdfUrl",
  source_project: "sourceProjectUrl",
};

async function hydrateSignedResources(songs: Song[]): Promise<Song[]> {
  if (!songs.length) return songs;
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("song_files").select("song_id,file_type,storage_path,version").in("song_id", songs.map((song) => song.id)).order("version", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, { songId: string; fileType: UploadFileType; path: string }>();
  for (const row of data ?? []) {
    const fileType = String(row.file_type) as UploadFileType;
    const key = `${row.song_id}:${fileType}`;
    if (resourceProperties[fileType] && !latest.has(key)) latest.set(key, { songId: String(row.song_id), fileType, path: String(row.storage_path) });
  }
  const hydrated = songs.map((song) => ({ ...song }));
  const byBucket = new Map<string, Array<{ songId: string; fileType: UploadFileType; path: string }>>();
  for (const entry of latest.values()) {
    const bucket = fileRules[entry.fileType].bucket;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), entry]);
  }
  for (const [bucket, entries] of byBucket) {
    const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrls(entries.map((entry) => entry.path), 3600);
    if (signError) throw signError;
    entries.forEach((entry, index) => {
      const song = hydrated.find((candidate) => candidate.id === entry.songId);
      const property = resourceProperties[entry.fileType];
      const signedUrl = signed?.[index]?.signedUrl;
      if (song && property && signedUrl) song[property] = signedUrl;
    });
  }
  return hydrated;
}

export async function loadPublishedSongsFromSupabase(): Promise<Song[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("songs").select(songSelect).eq("status", "published").order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return hydrateLearningConfiguration(await hydrateSignedResources((data as SongRow[]).map(songFromRow)));
}

export interface CatalogPageOptions {
  offset?: number;
  limit?: number;
  filters?: SongFilters;
  signal?: AbortSignal;
}

export interface CatalogPage { songs: Song[]; total: number; offset: number; limit: number; hasMore: boolean; }

function safeSearchTerm(value: string): string {
  return value.normalize("NFC").trim().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").slice(0, 120);
}

export async function loadPublishedSongPage(options: CatalogPageOptions = {}): Promise<CatalogPage | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(48, Math.max(1, options.limit ?? 24));
  const filters = options.filters;
  let query = supabase.from("songs").select(songSelect, { count: "exact" }).eq("status", "published");
  const search = safeSearchTerm(filters?.query ?? "");
  if (search) query = query.or(`title_ka.ilike.%${search}%,title_en.ilike.%${search}%,display_credit.ilike.%${search}%,composer.ilike.%${search}%,lyricist.ilike.%${search}%`);
  if (filters?.language) query = query.eq("language", filters.language);
  if (filters?.lyricist) query = query.ilike("lyricist", `%${safeSearchTerm(filters.lyricist)}%`);
  if (filters?.composer) query = query.ilike("composer", `%${safeSearchTerm(filters.composer)}%`);
  if (filters?.difficulty) query = query.eq("difficulty", filters.difficulty);
  const resourceColumn = filters?.resource === "audio" ? "audio_url" : filters?.resource === "midi" ? "midi_url" : filters?.resource === "musicxml" ? "musicxml_url" : filters?.resource === "score" ? "score_pdf_url" : null;
  if (resourceColumn) query = query.not(resourceColumn, "is", null);
  if (filters?.resource === "lyrics") query = query.or("lyrics_ka.not.is.null,lyrics_en.not.is.null");
  query = query.order("published_at", { ascending: false, nullsFirst: false }).order("id", { ascending: true }).range(offset, offset + limit - 1);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error, count } = await query;
  if (error) throw error;
  const songs = await hydrateLearningConfiguration(await hydrateSignedResources((data as SongRow[]).map(songFromRow)));
  const total = count ?? songs.length;
  return { songs, total, offset, limit, hasMore: offset + songs.length < total };
}

export async function loadPublishedSongBySlug(slug: string, signal?: AbortSignal): Promise<Song | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  let query = supabase.from("songs").select(songSelect).eq("status", "published").eq("slug", slug);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [song] = await hydrateLearningConfiguration(await hydrateSignedResources([songFromRow(data as SongRow)]));
  return song ?? null;
}

export async function loadAdminSongs(): Promise<Song[]> {
  const { data, error } = await requireSupabase().from("songs").select(songSelect).order("updated_at", { ascending: false });
  if (error) throw error;
  return hydrateLearningConfiguration(await hydrateSignedResources((data as SongRow[]).map(songFromRow)));
}

export type DraftPreviewResult =
  | { status: "authenticated"; song: Song }
  | { status: "login-required" | "access-denied" | "not-found" };

export async function loadOwnerDraftPreview(slug: string): Promise<DraftPreviewResult> {
  const supabase = requireSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return { status: "login-required" };
  if (!await isCurrentUserAdmin()) return { status: "access-denied" };

  const { data, error } = await supabase.from("songs").select(songSelect).eq("slug", slug).eq("status", "draft").maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not-found" };
  const [song] = await hydrateLearningConfiguration(await hydrateSignedResources([songFromRow(data as SongRow)]));
  return { status: "authenticated", song };
}

export async function saveSong(song: Song): Promise<Song> {
  const row = songToRow(song);
  if (row.id === undefined) delete row.id;
  const { data, error } = await requireSupabase().from("songs").upsert(row, { onConflict: "slug" }).select(songSelect).single();
  if (error) throw error;
  return songFromRow(data as SongRow);
}

export async function updateSongResources(songId: string, changes: Partial<Record<"cover_url" | "audio_url" | "midi_url" | "musicxml_url" | "score_pdf_url" | "source_project_url", string>>): Promise<void> {
  const { error } = await requireSupabase().from("songs").update(changes).eq("id", songId);
  if (error) throw error;
}

export async function updateLearningConfiguration(songId: string, config: Pick<Song, "learningEnabled" | "learningInstruments" | "learningSource" | "learningMapping" | "learningFingering">): Promise<void> {
  const { error } = await requireSupabase().from("songs").update({ learning_enabled: config.learningEnabled, learning_instruments: config.learningInstruments ?? [], learning_source_type: config.learningSource ?? "musicxml", learning_mapping: config.learningMapping ?? {}, learning_fingering: config.learningFingering ?? {} }).eq("id", songId);
  if (error) throw error;
}

export async function setSongStatus(songId: string, status: "draft" | "published"): Promise<void> {
  const { error } = await requireSupabase().rpc("set_song_publication_with_learning", {
    p_song_id: songId,
    p_status: status,
  });
  if (error) throw error;
}

export async function deleteSong(songId: string): Promise<void> {
  const supabase = requireSupabase();
  const { data: files, error: filesError } = await supabase.from("song_files").select("file_type,storage_path").eq("song_id", songId);
  if (filesError) throw filesError;
  const pathsByBucket = new Map<string, string[]>();
  for (const file of files ?? []) {
    const fileType = String(file.file_type) as UploadFileType;
    const rule = fileRules[fileType];
    if (!rule) throw new Error(`Unsupported stored file type: ${fileType}`);
    pathsByBucket.set(rule.bucket, [...(pathsByBucket.get(rule.bucket) ?? []), String(file.storage_path)]);
  }
  for (const [bucket, paths] of pathsByBucket) {
    const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
    if (storageError) throw storageError;
  }
  const { error } = await supabase.from("songs").delete().eq("id", songId);
  if (error) throw error;
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = requireSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw error;
  return data === true;
}
