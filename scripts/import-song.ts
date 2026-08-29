import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupLiteralNewlines,
  fileRules,
  safeStorageFilename,
  type UploadFileType,
} from "../src/utils/file-validation";
import { safeHttpUrl } from "../src/utils/safe-url";
import { extractYouTubeVideoId } from "../src/utils/youtube";

type Instrument = "piano" | "guitar";
type CanonicalSource = "musicxml" | "midi";

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
  source_project_url?: string | null;
  suno_url?: string | null;
  youtube_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  musical_key?: string | null;
  time_signature?: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced" | null;
  learning_enabled?: boolean;
  learning_instruments?: Instrument[];
  canonical_source?: CanonicalSource;
  part_mapping?: Record<string, unknown>;
  fingering_overrides?: Record<string, unknown>;
}

export interface PackageFile {
  relativePath: string;
  filename: string;
  fileType: UploadFileType;
  column: string | null;
  mimeType: string;
  buffer: Buffer;
  checksum: string;
  instrument?: Instrument;
  partKind?: CanonicalSource;
}

export interface UploadedObject {
  bucket: string;
  path: string;
  filename: string;
}

export interface ImportedInstrumentPart {
  id: string;
  instrument: Instrument;
  musicxmlUrl: string | null;
  midiUrl: string | null;
}

export interface ImportReport {
  dryRun: boolean;
  slug: string;
  valid: boolean;
  partial: boolean;
  uploaded: UploadedObject[];
  reused: string[];
  skipped: string[];
  issues: string[];
  instrumentParts: ImportedInstrumentPart[];
  songId?: string;
}

interface ImportOptions {
  client?: SupabaseClient;
  environment?: Record<string, string | undefined>;
}

const auxiliaryFiles = new Set(["SHA256SUMS.txt", "UPLOAD_NOTES.txt"]);

const knownTopLevelFiles: Array<{
  patterns: RegExp[];
  fileType: UploadFileType;
  column: string | null;
  mimeType: string;
}> = [
  { patterns: [/^audio\.mp3$/i], fileType: "audio", column: "audio_url", mimeType: "audio/mpeg" },
  { patterns: [/^cover\.(jpe?g|png|webp)$/i], fileType: "cover", column: "cover_url", mimeType: "image/webp" },
  { patterns: [/^lyrics-ka\.txt$/i, /^lyrics-en\.txt$/i], fileType: "lyrics", column: null, mimeType: "text/plain" },
  { patterns: [/^score\.(musicxml|xml)$/i], fileType: "musicxml", column: "musicxml_url", mimeType: "application/vnd.recordare.musicxml+xml" },
  { patterns: [/^score\.mxl$/i], fileType: "musicxml", column: "musicxml_url", mimeType: "application/vnd.recordare.musicxml" },
  { patterns: [/^performance\.(mid|midi)$/i], fileType: "midi", column: "midi_url", mimeType: "audio/midi" },
  { patterns: [/^score\.pdf$/i], fileType: "score_pdf", column: "score_pdf_url", mimeType: "application/pdf" },
  { patterns: [/^source\.mscz$/i], fileType: "source_project", column: "source_project_url", mimeType: "application/x-musescore" },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateMetadata(value: unknown): { metadata: ImportMetadata | null; issues: string[] } {
  const issues: string[] = [];
  if (!isObject(value)) return { metadata: null, issues: ["metadata.json must contain an object."] };
  if (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) {
    issues.push("metadata.slug must use lowercase letters, numbers and hyphens.");
  }
  for (const key of ["title_ka", "title_en"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) issues.push(`metadata.${key} is required.`);
  }
  if (value.status !== undefined && value.status !== "draft" && value.status !== "published") {
    issues.push("metadata.status must be draft or published.");
  }
  if (value.youtube_url && (typeof value.youtube_url !== "string" || !extractYouTubeVideoId(value.youtube_url))) {
    issues.push("metadata.youtube_url is invalid.");
  }
  for (const key of ["suno_url", "source_project_url"] as const) {
    if (value[key] && (typeof value[key] !== "string" || !safeHttpUrl(value[key]))) {
      issues.push(`metadata.${key} must use HTTPS.`);
    }
  }
  if (value.bpm !== undefined && value.bpm !== null && (typeof value.bpm !== "number" || value.bpm < 1 || value.bpm > 400)) {
    issues.push("metadata.bpm must be between 1 and 400.");
  }
  if (value.duration_seconds !== undefined && value.duration_seconds !== null && (typeof value.duration_seconds !== "number" || value.duration_seconds <= 0)) {
    issues.push("metadata.duration_seconds must be positive.");
  }
  const allowedInstruments: Instrument[] = ["piano", "guitar"];
  if (value.learning_enabled !== undefined && typeof value.learning_enabled !== "boolean") {
    issues.push("metadata.learning_enabled must be boolean.");
  }
  if (
    value.learning_instruments !== undefined &&
    (!Array.isArray(value.learning_instruments) ||
      value.learning_instruments.some((entry) => !allowedInstruments.includes(entry as Instrument)))
  ) {
    issues.push("metadata.learning_instruments may contain only piano and guitar.");
  }
  if (value.canonical_source !== undefined && value.canonical_source !== "musicxml" && value.canonical_source !== "midi") {
    issues.push("metadata.canonical_source must be musicxml or midi.");
  }
  for (const key of ["part_mapping", "fingering_overrides"] as const) {
    if (value[key] !== undefined && !isObject(value[key])) issues.push(`metadata.${key} must be a JSON object.`);
  }
  if (value.learning_enabled === true && (!Array.isArray(value.learning_instruments) || value.learning_instruments.length === 0)) {
    issues.push("Learning-enabled packages must name at least one instrument.");
  }
  return { metadata: issues.length ? null : value as unknown as ImportMetadata, issues };
}

function detectMime(filename: string, buffer: Buffer): string | null {
  const extension = path.extname(filename).toLowerCase();
  if (/^lyrics-(ka|en)\.txt$/i.test(filename)) return buffer.includes(0) ? null : "text/plain";
  if (extension === ".mid" || extension === ".midi") return buffer.subarray(0, 4).toString("ascii") === "MThd" ? "audio/midi" : null;
  if (extension === ".pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : null;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : null;
  if (extension === ".jpg" || extension === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? "image/jpeg" : null;
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null;
  if (extension === ".mp3") return buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ? "audio/mpeg" : null;
  if (extension === ".mxl" || extension === ".mscz") return buffer[0] === 0x50 && buffer[1] === 0x4b ? extension === ".mxl" ? "application/vnd.recordare.musicxml" : "application/x-musescore" : null;
  if (extension === ".musicxml" || extension === ".xml") {
    const start = buffer.subarray(0, 512).toString("utf8").trimStart();
    return /^(<\?xml|<score-(partwise|timewise))/.test(start) ? "application/vnd.recordare.musicxml+xml" : null;
  }
  return null;
}

async function listRelativeFiles(folder: string, issues: string[]): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
      continue;
    }
    if (entry.isDirectory() && entry.name === "instrument-parts") {
      const partEntries = await readdir(path.join(folder, entry.name), { withFileTypes: true });
      for (const partEntry of partEntries) {
        const relative = `instrument-parts/${partEntry.name}`;
        if (partEntry.isFile()) files.push(relative);
        else issues.push(`Unexpected package entry: ${relative}`);
      }
      continue;
    }
    issues.push(`Unexpected file: ${entry.name}`);
  }
  return files.sort();
}

async function verifyChecksumManifest(folder: string, relativeFiles: string[]): Promise<string[]> {
  if (!relativeFiles.includes("SHA256SUMS.txt")) return [];
  const issues: string[] = [];
  const actualFiles = relativeFiles.filter((entry) => entry !== "SHA256SUMS.txt");
  const expected = new Map<string, string>();
  const lines = (await readFile(path.join(folder, "SHA256SUMS.txt"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line);
    if (!match) {
      issues.push("SHA256SUMS.txt contains an invalid line.");
      continue;
    }
    const manifestPath = match[2].replace(/\\/g, "/");
    const relative = actualFiles.find(
      (candidate) => manifestPath === candidate || manifestPath.endsWith(`/${candidate}`),
    );
    if (!relative) {
      issues.push(`SHA256SUMS.txt references a missing file: ${path.posix.basename(manifestPath)}`);
      continue;
    }
    if (expected.has(relative)) issues.push(`SHA256SUMS.txt repeats ${relative}.`);
    expected.set(relative, match[1].toLowerCase());
  }
  for (const relative of actualFiles) {
    const checksum = expected.get(relative);
    if (!checksum) {
      issues.push(`SHA256SUMS.txt does not list ${relative}.`);
      continue;
    }
    const buffer = await readFile(path.join(folder, ...relative.split("/")));
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== checksum) issues.push(`Checksum mismatch: ${relative}.`);
  }
  return issues;
}

function classifyFile(relativePath: string): Omit<PackageFile, "buffer" | "checksum"> | null {
  const filename = path.posix.basename(relativePath);
  const topLevel = !relativePath.includes("/")
    ? knownTopLevelFiles.find((entry) => entry.patterns.some((pattern) => pattern.test(filename)))
    : null;
  if (topLevel) return { relativePath, filename, ...topLevel };
  const partMatch = /^instrument-parts\/(piano|guitar)\.(musicxml|xml|mxl|mid|midi)$/i.exec(relativePath);
  if (!partMatch) return null;
  const instrument = partMatch[1].toLowerCase() as Instrument;
  const partKind: CanonicalSource = /mid(i)?$/i.test(partMatch[2]) ? "midi" : "musicxml";
  return {
    relativePath,
    filename,
    fileType: "instrument_part",
    column: null,
    mimeType: partKind === "midi" ? "audio/midi" : "application/vnd.recordare.musicxml+xml",
    instrument,
    partKind,
  };
}

export async function inspectSongPackage(packagePath: string): Promise<{
  metadata: ImportMetadata | null;
  files: PackageFile[];
  issues: string[];
}> {
  const issues: string[] = [];
  const folder = path.resolve(packagePath);
  const folderStat = await stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) return { metadata: null, files: [], issues: [`Package folder does not exist: ${folder}`] };
  const relativeFiles = await listRelativeFiles(folder, issues);
  if (!relativeFiles.includes("metadata.json")) return { metadata: null, files: [], issues: [...issues, "metadata.json is required."] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(folder, "metadata.json"), "utf8"));
  } catch (error) {
    return { metadata: null, files: [], issues: [...issues, `metadata.json is invalid: ${error instanceof Error ? error.message : "parse error"}`] };
  }
  const checked = validateMetadata(parsed);
  issues.push(...checked.issues);
  issues.push(...await verifyChecksumManifest(folder, relativeFiles));
  const files: PackageFile[] = [];
  for (const relativePath of relativeFiles) {
    if (relativePath === "metadata.json" || auxiliaryFiles.has(relativePath)) continue;
    const definition = classifyFile(relativePath);
    if (!definition) {
      issues.push(`Unexpected file: ${relativePath}`);
      continue;
    }
    const buffer = await readFile(path.join(folder, ...relativePath.split("/")));
    const rule = fileRules[definition.fileType];
    if (!buffer.length) {
      issues.push(`${relativePath} is empty.`);
      continue;
    }
    if (buffer.length > rule.maxBytes) {
      issues.push(`${relativePath} exceeds ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
      continue;
    }
    const mimeType = detectMime(definition.filename, buffer);
    if (!mimeType || !rule.mimeTypes.includes(mimeType)) {
      issues.push(`${relativePath} content does not match its supported MIME type.`);
      continue;
    }
    files.push({
      ...definition,
      mimeType,
      buffer,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    });
  }
  if (relativeFiles.filter((name) => /^score\.(musicxml|xml|mxl)$/i.test(name)).length > 1) {
    issues.push("Provide only one score.musicxml, score.xml, or score.mxl file.");
  }
  for (const instrument of ["piano", "guitar"] as const) {
    for (const kind of ["musicxml", "midi"] as const) {
      if (files.filter((file) => file.instrument === instrument && file.partKind === kind).length > 1) {
        issues.push(`Provide only one ${kind} file for the ${instrument} instrument part.`);
      }
    }
  }
  if (checked.metadata?.learning_enabled) {
    const source = checked.metadata.canonical_source ?? "musicxml";
    const hasCanonical = files.some((file) => source === "musicxml" ? file.fileType === "musicxml" : file.fileType === "midi");
    if (!hasCanonical) issues.push(`The selected canonical ${source} source is missing.`);
  }
  return { metadata: checked.metadata, files, issues };
}

export function mapMetadataToSongRow(
  metadata: ImportMetadata,
  lyricsKa: string | null,
  lyricsEn: string | null,
  canonicalChecksum: string | null,
): Record<string, unknown> {
  return {
    slug: metadata.slug,
    status: metadata.status ?? "draft",
    title_ka: metadata.title_ka,
    title_en: metadata.title_en,
    display_credit: metadata.display_credit ?? null,
    composer: metadata.composer ?? null,
    lyricist: metadata.lyricist ?? null,
    translator: metadata.translator ?? null,
    language: metadata.language ?? null,
    description_ka: metadata.description_ka ?? null,
    description_en: metadata.description_en ?? null,
    lyrics_ka: lyricsKa,
    lyrics_en: lyricsEn,
    source_project_url: metadata.source_project_url ?? null,
    suno_url: metadata.suno_url ?? null,
    youtube_url: metadata.youtube_url ?? null,
    youtube_video_id: extractYouTubeVideoId(metadata.youtube_url),
    duration_seconds: metadata.duration_seconds == null ? null : Math.round(metadata.duration_seconds),
    bpm: metadata.bpm ?? null,
    musical_key: metadata.musical_key ?? null,
    time_signature: metadata.time_signature ?? null,
    difficulty: metadata.difficulty ?? null,
    learning_enabled: metadata.learning_enabled ?? false,
    learning_instruments: metadata.learning_instruments ?? [],
    learning_source_type: metadata.canonical_source ?? "musicxml",
    learning_source_checksum: canonicalChecksum,
    learning_mapping: metadata.part_mapping ?? {},
    learning_fingering: metadata.fingering_overrides ?? {},
  };
}

export function isDuplicateChecksum(checksum: string, knownChecksums: Iterable<string>): boolean {
  return new Set(knownChecksums).has(checksum);
}

export function isTrustedServerCredential(key: string | undefined): boolean {
  if (!key || key.startsWith("sb_publishable_")) return false;
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
    return decoded.role === "service_role";
  } catch {
    return false;
  }
}

export function markImportFailure(report: ImportReport, error: unknown): ImportReport {
  report.valid = false;
  report.partial = Boolean(report.songId || report.uploaded.length || report.instrumentParts.length);
  report.issues.push(error instanceof Error ? error.message : String(error));
  return report;
}

function storagePathFor(metadata: ImportMetadata, file: PackageFile): string {
  const filename = `${file.checksum.slice(0, 12)}-${safeStorageFilename(file.filename)}`;
  return file.instrument
    ? `${metadata.slug}/instrument-parts/${file.instrument}/${filename}`
    : `${metadata.slug}/${filename}`;
}

function fingeringFor(metadata: ImportMetadata, instrument: Instrument): Record<string, unknown> {
  const value = metadata.fingering_overrides?.[instrument];
  return isObject(value) ? value : {};
}

export async function runImport(
  packagePath: string,
  dryRun: boolean,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const inspected = await inspectSongPackage(packagePath);
  const report: ImportReport = {
    dryRun,
    slug: inspected.metadata?.slug ?? "unknown",
    valid: inspected.issues.length === 0,
    partial: false,
    uploaded: [],
    reused: [],
    skipped: [],
    issues: [...inspected.issues],
    instrumentParts: [],
  };
  if (!inspected.metadata || inspected.issues.length) return report;
  if (dryRun) {
    report.skipped = inspected.files.map((file) => `${file.relativePath} (${file.checksum})`);
    return report;
  }

  const environment = options.environment ?? process.env;
  let supabase = options.client;
  if (!supabase) {
    const url = environment.SUPABASE_URL;
    const serverKey = environment.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !isTrustedServerCredential(serverKey)) {
      report.valid = false;
      report.issues.push("A trusted local SUPABASE_URL and server-only service credential are required.");
      return report;
    }
    supabase = createClient(url, serverKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  const metadata = inspected.metadata;
  const lyricsKaFile = inspected.files.find((file) => file.relativePath.toLowerCase() === "lyrics-ka.txt");
  const lyricsEnFile = inspected.files.find((file) => file.relativePath.toLowerCase() === "lyrics-en.txt");
  const canonicalKind = metadata.canonical_source ?? "musicxml";
  const canonicalFile = inspected.files.find((file) => file.fileType === canonicalKind);
  const row = mapMetadataToSongRow(
    metadata,
    lyricsKaFile ? cleanupLiteralNewlines(lyricsKaFile.buffer.toString("utf8")) : null,
    lyricsEnFile ? cleanupLiteralNewlines(lyricsEnFile.buffer.toString("utf8")) : null,
    canonicalFile?.checksum ?? null,
  );

  try {
    const { data: song, error: songError } = await supabase
      .from("songs")
      .upsert(row, { onConflict: "slug" })
      .select("id")
      .single();
    if (songError) throw songError;
    report.songId = String(song.id);

    const resourceChanges: Record<string, string> = {};
    const packageChecksums = new Set<string>();
    const packageUrls = new Map<string, string>();
    const partRows = new Map<Instrument, Record<string, unknown>>();

    const rememberUrl = (file: PackageFile, publicUrl: string): void => {
      if (file.column) resourceChanges[file.column] = publicUrl;
      if (file.instrument && file.partKind) {
        const current: Record<string, unknown> = partRows.get(file.instrument) ?? {
          song_id: song.id,
          instrument: file.instrument,
          fingering_json: fingeringFor(metadata, file.instrument),
          difficulty: metadata.difficulty ?? null,
        };
        current[file.partKind === "musicxml" ? "musicxml_url" : "midi_url"] = publicUrl;
        partRows.set(file.instrument, current);
      }
    };

    for (const file of inspected.files) {
      if (isDuplicateChecksum(file.checksum, packageChecksums)) {
        report.reused.push(file.relativePath);
        const reusedUrl = packageUrls.get(file.checksum);
        if (reusedUrl) rememberUrl(file, reusedUrl);
        continue;
      }
      const { data: existing, error: duplicateError } = await supabase
        .from("song_files")
        .select("public_url,storage_path")
        .eq("song_id", song.id)
        .eq("checksum", file.checksum)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (existing) {
        const existingUrl = String(existing.public_url);
        report.reused.push(file.relativePath);
        packageChecksums.add(file.checksum);
        packageUrls.set(file.checksum, existingUrl);
        rememberUrl(file, existingUrl);
        continue;
      }

      const rule = fileRules[file.fileType];
      const storagePath = storagePathFor(metadata, file);
      const { error: uploadError } = await supabase.storage
        .from(rule.bucket)
        .upload(storagePath, file.buffer, { contentType: file.mimeType, upsert: false });
      if (uploadError && !/already exists/i.test(uploadError.message)) throw uploadError;
      const publicUrl = supabase.storage.from(rule.bucket).getPublicUrl(storagePath).data.publicUrl;
      report.uploaded.push({ bucket: rule.bucket, path: storagePath, filename: file.relativePath });
      const { data: version, error: versionError } = await supabase
        .from("song_files")
        .select("version")
        .eq("song_id", song.id)
        .eq("file_type", file.fileType)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (versionError) throw versionError;
      const { error: fileError } = await supabase.from("song_files").upsert(
        {
          song_id: song.id,
          file_type: file.fileType,
          storage_path: storagePath,
          public_url: publicUrl,
          original_filename: file.relativePath,
          mime_type: file.mimeType,
          file_size: file.buffer.length,
          checksum: file.checksum,
          version: Number(version?.version ?? 0) + 1,
        },
        { onConflict: "song_id,checksum" },
      );
      if (fileError) throw fileError;
      rememberUrl(file, publicUrl);
      packageChecksums.add(file.checksum);
      packageUrls.set(file.checksum, publicUrl);
    }

    if (Object.keys(resourceChanges).length) {
      const { error } = await supabase.from("songs").update(resourceChanges).eq("id", song.id);
      if (error) throw error;
    }
    for (const [instrument, partRow] of partRows) {
      const { data, error } = await supabase
        .from("instrument_parts")
        .upsert(partRow, { onConflict: "song_id,instrument" })
        .select("id,instrument,musicxml_url,midi_url")
        .single();
      if (error) throw error;
      report.instrumentParts.push({
        id: String(data.id),
        instrument,
        musicxmlUrl: data.musicxml_url ? String(data.musicxml_url) : null,
        midiUrl: data.midi_url ? String(data.midi_url) : null,
      });
    }
    return report;
  } catch (error) {
    return markImportFailure(report, error);
  }
}

function parseArgs(args: string[]): { packagePath: string | null; dryRun: boolean } {
  return {
    packagePath: args.find((arg) => !arg.startsWith("--")) ?? null,
    dryRun: args.includes("--dry-run"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.packagePath) {
    console.error("Usage: pnpm import:song -- <song-package-folder> [--dry-run]");
    process.exitCode = 2;
  } else {
    runImport(args.packagePath, args.dryRun)
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        if (!report.valid) process.exitCode = 1;
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
