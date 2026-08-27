import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { cleanupLiteralNewlines, fileRules, safeStorageFilename, type UploadFileType } from "../src/utils/file-validation";
import { extractYouTubeVideoId } from "../src/utils/youtube";
import { safeHttpUrl } from "../src/utils/safe-url";

export interface ImportMetadata {
  slug: string;
  status?: "draft" | "published";
  title_ka: string;
  title_en: string;
  display_credit?: string | null;
  composer?: string | null;
  lyricist?: string | null;
  translator?: string | null;
  language?: string | null;
  description_ka?: string | null;
  description_en?: string | null;
  suno_url?: string | null;
  youtube_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  musical_key?: string | null;
  time_signature?: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced" | null;
}

interface PackageFile { filename: string; fileType: UploadFileType; column: string | null; mimeType: string; buffer: Buffer; checksum: string; }
export interface ImportReport { dryRun: boolean; slug: string; valid: boolean; uploaded: string[]; reused: string[]; skipped: string[]; issues: string[]; songId?: string; }

export function isDuplicateChecksum(checksum: string, knownChecksums: Iterable<string>): boolean {
  return new Set(knownChecksums).has(checksum);
}

const knownFiles: Array<{ patterns: RegExp[]; fileType: UploadFileType; column: string | null; mimeType: string }> = [
  { patterns: [/^audio\.mp3$/i], fileType: "audio", column: "audio_url", mimeType: "audio/mpeg" },
  { patterns: [/^cover\.(jpe?g|png|webp)$/i], fileType: "cover", column: "cover_url", mimeType: "image/webp" },
  { patterns: [/^lyrics-ka\.txt$/i, /^lyrics-en\.txt$/i], fileType: "lyrics", column: null, mimeType: "text/plain" },
  { patterns: [/^score\.(musicxml|xml)$/i], fileType: "musicxml", column: "musicxml_url", mimeType: "application/vnd.recordare.musicxml+xml" },
  { patterns: [/^score\.mxl$/i], fileType: "musicxml", column: "musicxml_url", mimeType: "application/vnd.recordare.musicxml" },
  { patterns: [/^performance\.(mid|midi)$/i], fileType: "midi", column: "midi_url", mimeType: "audio/midi" },
  { patterns: [/^score\.pdf$/i], fileType: "score_pdf", column: "score_pdf_url", mimeType: "application/pdf" },
  { patterns: [/^source\.mscz$/i], fileType: "source_project", column: "source_project_url", mimeType: "application/x-musescore" },
];

function validateMetadata(value: unknown): { metadata: ImportMetadata | null; issues: string[] } {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { metadata: null, issues: ["metadata.json must contain an object."] };
  const entry = value as Record<string, unknown>;
  if (typeof entry.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) issues.push("metadata.slug must use lowercase letters, numbers and hyphens.");
  for (const key of ["title_ka", "title_en"] as const) if (typeof entry[key] !== "string" || !entry[key].trim()) issues.push(`metadata.${key} is required.`);
  if (entry.status !== undefined && entry.status !== "draft" && entry.status !== "published") issues.push("metadata.status must be draft or published.");
  if (entry.youtube_url) {
    if (typeof entry.youtube_url !== "string" || !extractYouTubeVideoId(entry.youtube_url)) issues.push("metadata.youtube_url is invalid.");
  }
  if (entry.suno_url && (typeof entry.suno_url !== "string" || !safeHttpUrl(entry.suno_url))) issues.push("metadata.suno_url must use HTTPS.");
  if (entry.bpm !== undefined && entry.bpm !== null && (typeof entry.bpm !== "number" || entry.bpm < 1 || entry.bpm > 400)) issues.push("metadata.bpm must be between 1 and 400.");
  if (entry.duration_seconds !== undefined && entry.duration_seconds !== null && (typeof entry.duration_seconds !== "number" || entry.duration_seconds <= 0)) issues.push("metadata.duration_seconds must be positive.");
  return { metadata: issues.length ? null : entry as unknown as ImportMetadata, issues };
}

function detectMime(filename: string, buffer: Buffer): string | null {
  const extension = path.extname(filename).toLowerCase();
  if (/^lyrics-(ka|en)\.txt$/i.test(filename)) return buffer.includes(0) ? null : "text/plain";
  if (extension === ".mid" || extension === ".midi") return buffer.subarray(0, 4).toString("ascii") === "MThd" ? "audio/midi" : null;
  if (extension === ".pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : null;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : null;
  if (extension === ".jpg" || extension === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? "image/jpeg" : null;
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null;
  if (extension === ".mp3") return buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ? "audio/mpeg" : null;
  if (extension === ".mxl" || extension === ".mscz") return buffer[0] === 0x50 && buffer[1] === 0x4b ? extension === ".mxl" ? "application/vnd.recordare.musicxml" : "application/x-musescore" : null;
  if (extension === ".musicxml" || extension === ".xml") { const start = buffer.subarray(0, 512).toString("utf8").trimStart(); return /^(<\?xml|<score-(partwise|timewise))/.test(start) ? "application/vnd.recordare.musicxml+xml" : null; }
  return null;
}

export async function inspectSongPackage(packagePath: string): Promise<{ metadata: ImportMetadata | null; files: PackageFile[]; issues: string[] }> {
  const issues: string[] = [];
  const folder = path.resolve(packagePath);
  const folderStat = await stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) return { metadata: null, files: [], issues: [`Package folder does not exist: ${folder}`] };
  const names = await readdir(folder);
  if (!names.includes("metadata.json")) return { metadata: null, files: [], issues: ["metadata.json is required."] };
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path.join(folder, "metadata.json"), "utf8")); } catch (error) { return { metadata: null, files: [], issues: [`metadata.json is invalid: ${error instanceof Error ? error.message : "parse error"}`] }; }
  const checked = validateMetadata(parsed);
  issues.push(...checked.issues);
  const files: PackageFile[] = [];
  for (const name of names.filter((entry) => entry !== "metadata.json")) {
    const definition = knownFiles.find((entry) => entry.patterns.some((pattern) => pattern.test(name)));
    if (!definition) { issues.push(`Unexpected file: ${name}`); continue; }
    const buffer = await readFile(path.join(folder, name));
    const rule = fileRules[definition.fileType];
    if (!buffer.length) { issues.push(`${name} is empty.`); continue; }
    if (buffer.length > rule.maxBytes) { issues.push(`${name} exceeds ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`); continue; }
    const mimeType = detectMime(name, buffer);
    if (!mimeType || !rule.mimeTypes.includes(mimeType)) { issues.push(`${name} content does not match its supported MIME type.`); continue; }
    files.push({ filename: name, fileType: definition.fileType, column: definition.column, mimeType, buffer, checksum: createHash("sha256").update(buffer).digest("hex") });
  }
  if (names.filter((name) => /^score\.(musicxml|xml|mxl)$/i.test(name)).length > 1) issues.push("Provide only one score.musicxml, score.xml, or score.mxl file.");
  return { metadata: checked.metadata, files, issues };
}

export async function runImport(packagePath: string, dryRun: boolean): Promise<ImportReport> {
  const inspected = await inspectSongPackage(packagePath);
  const report: ImportReport = { dryRun, slug: inspected.metadata?.slug ?? "unknown", valid: inspected.issues.length === 0, uploaded: [], reused: [], skipped: [], issues: inspected.issues };
  if (!inspected.metadata || inspected.issues.length) return report;
  const metadata = inspected.metadata;
  const lyricsKaFile = inspected.files.find((file) => file.filename.toLowerCase() === "lyrics-ka.txt");
  const lyricsEnFile = inspected.files.find((file) => file.filename.toLowerCase() === "lyrics-en.txt");
  const row: Record<string, unknown> = {
    ...metadata,
    status: metadata.status ?? "draft",
    youtube_video_id: extractYouTubeVideoId(metadata.youtube_url),
    lyrics_ka: lyricsKaFile ? cleanupLiteralNewlines(lyricsKaFile.buffer.toString("utf8")) : null,
    lyrics_en: lyricsEnFile ? cleanupLiteralNewlines(lyricsEnFile.buffer.toString("utf8")) : null,
  };
  if (dryRun) { report.skipped = inspected.files.map((file) => `${file.filename} (${file.checksum})`); return report; }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) { report.valid = false; report.issues.push("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used."); return report; }
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: song, error: songError } = await supabase.from("songs").upsert(row, { onConflict: "slug" }).select("id").single();
  if (songError) { report.valid = false; report.issues.push(songError.message); return report; }
  report.songId = String(song.id);
  const resourceChanges: Record<string, string> = {};
  const packageChecksums = new Set<string>();
  const packageUrls = new Map<string, string>();
  for (const file of inspected.files) {
    if (isDuplicateChecksum(file.checksum, packageChecksums)) {
      report.reused.push(file.filename);
      const reusedUrl = packageUrls.get(file.checksum);
      if (file.column && reusedUrl) resourceChanges[file.column] = reusedUrl;
      continue;
    }
    const { data: existing, error: duplicateError } = await supabase.from("song_files").select("public_url,storage_path").eq("song_id", song.id).eq("checksum", file.checksum).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (existing) { report.reused.push(file.filename); packageChecksums.add(file.checksum); packageUrls.set(file.checksum, String(existing.public_url)); if (file.column) resourceChanges[file.column] = String(existing.public_url); continue; }
    const rule = fileRules[file.fileType];
    const storagePath = `${metadata.slug}/${file.checksum.slice(0, 12)}-${safeStorageFilename(file.filename)}`;
    const { error: uploadError } = await supabase.storage.from(rule.bucket).upload(storagePath, file.buffer, { contentType: file.mimeType, upsert: false });
    if (uploadError && !/already exists/i.test(uploadError.message)) throw uploadError;
    const publicUrl = supabase.storage.from(rule.bucket).getPublicUrl(storagePath).data.publicUrl;
    const { data: version } = await supabase.from("song_files").select("version").eq("song_id", song.id).eq("file_type", file.fileType).order("version", { ascending: false }).limit(1).maybeSingle();
    const { error: fileError } = await supabase.from("song_files").upsert({ song_id: song.id, file_type: file.fileType, storage_path: storagePath, public_url: publicUrl, original_filename: file.filename, mime_type: file.mimeType, file_size: file.buffer.length, checksum: file.checksum, version: Number(version?.version ?? 0) + 1 }, { onConflict: "song_id,checksum" });
    if (fileError) throw fileError;
    if (file.column) resourceChanges[file.column] = publicUrl;
    packageChecksums.add(file.checksum);
    packageUrls.set(file.checksum, publicUrl);
    report.uploaded.push(file.filename);
  }
  if (Object.keys(resourceChanges).length) {
    const { error } = await supabase.from("songs").update(resourceChanges).eq("id", song.id);
    if (error) throw error;
  }
  return report;
}

function parseArgs(args: string[]): { packagePath: string | null; dryRun: boolean } {
  return { packagePath: args.find((arg) => !arg.startsWith("--")) ?? null, dryRun: args.includes("--dry-run") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.packagePath) { console.error("Usage: pnpm import:song -- <song-package-folder> [--dry-run]"); process.exitCode = 2; }
  else runImport(args.packagePath, args.dryRun).then((report) => { console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; }).catch((error: unknown) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
}
