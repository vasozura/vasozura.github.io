import { createHash, randomUUID } from "node:crypto";
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
import { ZuraLearningClient } from "../src/lib/zura-api";

export type Instrument = "piano" | "guitar" | "accordion";
type CanonicalSource = "musicxml" | "midi";
type PartKind = CanonicalSource | "fingering" | "accordion_mapping";

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
  partKind?: PartKind;
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
  phase: "validation" | "staging" | "complete" | "compensated" | "failed";
  readiness: { ready: boolean; checks: string[] };
  compensated: string[];
  processing: { status: "not-required" | "pending" | "validated" | "complete" | "failed"; manifestKey?: string; reused?: boolean };
  checksums: Array<{ file: string; checksum: string }>;
}

export interface ImportOptions {
  client?: SupabaseClient;
  environment?: Record<string, string | undefined>;
  resume?: boolean;
  compensateOnFailure?: boolean;
}

const auxiliaryFiles = new Set(["SHA256SUMS.txt", "UPLOAD_NOTES.txt"]);
const MAX_PACKAGE_FILES = 2048;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;
const allowedMetadataKeys = new Set([
  "slug", "status", "title_ka", "title_en", "display_credit", "composer", "lyricist",
  "translator", "language", "description_ka", "description_en", "source_project_url",
  "suno_url", "youtube_url", "duration_seconds", "bpm", "musical_key", "time_signature",
  "difficulty", "learning_enabled", "learning_instruments", "canonical_source", "part_mapping",
  "fingering_overrides",
]);

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
  for (const key of Object.keys(value)) if (!allowedMetadataKeys.has(key)) issues.push(`metadata.${key} is not supported.`);
  if (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) {
    issues.push("metadata.slug must use lowercase letters, numbers and hyphens.");
  }
  for (const key of ["title_ka", "title_en"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) issues.push(`metadata.${key} is required.`);
  }
  for (const key of ["display_credit", "composer", "lyricist", "translator", "language", "description_ka", "description_en", "musical_key", "time_signature"] as const) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") issues.push(`metadata.${key} must be a string or null.`);
  }
  if (value.status !== undefined && value.status !== "draft" && value.status !== "published") {
    issues.push("metadata.status must be draft or published.");
  }
  if (value.status === "published") issues.push("Imports are draft-only. Publish later with the separately confirmed admin action.");
  if (value.youtube_url !== undefined && value.youtube_url !== null && (typeof value.youtube_url !== "string" || !extractYouTubeVideoId(value.youtube_url))) {
    issues.push("metadata.youtube_url is invalid.");
  }
  for (const key of ["suno_url", "source_project_url"] as const) {
    if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== "string" || !safeHttpUrl(value[key]))) {
      issues.push(`metadata.${key} must use HTTPS.`);
    }
  }
  if (value.bpm !== undefined && value.bpm !== null && (typeof value.bpm !== "number" || value.bpm < 1 || value.bpm > 400)) {
    issues.push("metadata.bpm must be between 1 and 400.");
  }
  if (value.duration_seconds !== undefined && value.duration_seconds !== null && (typeof value.duration_seconds !== "number" || value.duration_seconds <= 0)) {
    issues.push("metadata.duration_seconds must be positive.");
  }
  if (value.difficulty !== undefined && value.difficulty !== null && !["beginner", "intermediate", "advanced"].includes(String(value.difficulty))) {
    issues.push("metadata.difficulty must be beginner, intermediate, advanced or null.");
  }
  const allowedInstruments: Instrument[] = ["piano", "guitar", "accordion"];
  if (value.learning_enabled !== undefined && typeof value.learning_enabled !== "boolean") {
    issues.push("metadata.learning_enabled must be boolean.");
  }
  if (
    value.learning_instruments !== undefined &&
    (!Array.isArray(value.learning_instruments) ||
      value.learning_instruments.some((entry) => !allowedInstruments.includes(entry as Instrument)))
  ) {
    issues.push("metadata.learning_instruments may contain only piano, guitar and accordion.");
  } else if (Array.isArray(value.learning_instruments) && new Set(value.learning_instruments).size !== value.learning_instruments.length) {
    issues.push("metadata.learning_instruments must not contain duplicates.");
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
  if (extension === ".json") {
    if (buffer.includes(0)) return null;
    try { JSON.parse(buffer.toString("utf8")); return "application/json"; }
    catch { return null; }
  }
  return null;
}

export interface ArchiveEntryDescriptor { path: string; compressedBytes: number; uncompressedBytes: number; directory?: boolean; }

export function validateArchiveEntries(entries: ArchiveEntryDescriptor[]): string[] {
  const issues: string[] = [];
  if (entries.length > MAX_PACKAGE_FILES) issues.push(`Archive contains more than ${MAX_PACKAGE_FILES} entries.`);
  let total = 0;
  for (const entry of entries) {
    const normalized = entry.path.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
      issues.push(`Unsafe archive path: ${path.posix.basename(normalized) || "empty"}.`);
    }
    if (entry.uncompressedBytes < 0 || entry.compressedBytes < 0) issues.push(`Invalid archive size: ${path.posix.basename(normalized)}.`);
    total += Math.max(0, entry.uncompressedBytes);
    if (!entry.directory && entry.uncompressedBytes > 1024 * 1024 && entry.compressedBytes > 0 && entry.uncompressedBytes / entry.compressedBytes > MAX_ARCHIVE_RATIO) {
      issues.push(`Suspicious compression ratio: ${path.posix.basename(normalized)}.`);
    }
  }
  if (total > MAX_PACKAGE_BYTES) issues.push("Archive expands beyond the 512 MB package limit.");
  return issues;
}

function parseJsonObject(file: PackageFile, issues: string[]): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(file.buffer.toString("utf8"));
    if (!isObject(parsed)) { issues.push(`${file.relativePath} must contain a JSON object.`); return null; }
    return parsed;
  } catch { issues.push(`${file.relativePath} contains invalid JSON.`); return null; }
}

function validateAccordionMapping(value: Record<string, unknown>, filename: string): string[] {
  const issues: string[] = [];
  if (value.schema_version !== "zura-accordion-mapping/v1") issues.push(`${filename} must use schema_version zura-accordion-mapping/v1.`);
  if (value.verified !== true) issues.push(`${filename} must explicitly set verified=true.`);
  if (!Array.isArray(value.buttons) || value.buttons.length === 0) issues.push(`${filename} must contain verified buttons.`);
  const ids = new Set<string>();
  for (const [index, raw] of (Array.isArray(value.buttons) ? value.buttons : []).entries()) {
    if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || !["right", "left"].includes(String(raw.side)) || !Array.isArray(raw.midi) || !raw.midi.length || raw.midi.some((midi) => !Number.isInteger(midi) || Number(midi) < 0 || Number(midi) > 127)) {
      issues.push(`${filename} buttons[${index}] is invalid.`); continue;
    }
    if (ids.has(raw.id)) issues.push(`${filename} repeats button id ${raw.id}.`);
    ids.add(raw.id);
    if (raw.provenance === "inferred" && (raw.finger !== undefined || raw.bellows !== undefined)) issues.push(`${filename} cannot attach finger or bellows claims to inferred mappings.`);
  }
  return issues;
}

async function listRelativeFiles(folder: string, issues: string[], relativeFolder = ""): Promise<string[]> {
  const current = path.join(folder, ...relativeFolder.split("/").filter(Boolean));
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) { issues.push(`Symbolic links are not allowed: ${relative}`); continue; }
    if (entry.isFile()) {
      files.push(relative);
      continue;
    }
    if (entry.isDirectory() && (relative === "instrument-parts" || /^instrument-parts\/(piano|guitar|accordion)$/.test(relative))) {
      files.push(...await listRelativeFiles(folder, issues, relative));
      continue;
    }
    issues.push(`Unexpected package entry: ${relative}`);
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
  const partMatch = /^instrument-parts\/(piano|guitar|accordion)(?:\/(?:\1))?\.(musicxml|xml|mxl|mid|midi)$/i.exec(relativePath);
  const supportMatch = /^instrument-parts\/(piano|guitar)\/fingering\.json$/i.exec(relativePath)
    ?? /^instrument-parts\/(accordion)\/accordion-mapping\.json$/i.exec(relativePath);
  if (!partMatch && !supportMatch) return null;
  if (supportMatch) {
    const instrument = supportMatch[1].toLowerCase() as Instrument;
    return { relativePath, filename, fileType: "instrument_part", column: null, mimeType: "application/json", instrument, partKind: instrument === "accordion" ? "accordion_mapping" : "fingering" };
  }
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
  if (relativeFiles.length > MAX_PACKAGE_FILES) issues.push(`Package contains more than ${MAX_PACKAGE_FILES} files.`);
  let packageBytes = 0;
  for (const relative of relativeFiles) packageBytes += (await stat(path.join(folder, ...relative.split("/")))).size;
  if (packageBytes > MAX_PACKAGE_BYTES) issues.push("Package exceeds the 512 MB expanded-size limit.");
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
  for (const file of files.filter((entry) => entry.partKind === "accordion_mapping")) {
    const parsedMapping = parseJsonObject(file, issues);
    if (parsedMapping) issues.push(...validateAccordionMapping(parsedMapping, file.relativePath));
  }
  if (relativeFiles.filter((name) => /^score\.(musicxml|xml|mxl)$/i.test(name)).length > 1) {
    issues.push("Provide only one score.musicxml, score.xml, or score.mxl file.");
  }
  for (const instrument of ["piano", "guitar", "accordion"] as const) {
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
    for (const instrument of checked.metadata.learning_instruments ?? []) {
      if (!files.some((file) => file.instrument === instrument && file.partKind === "musicxml")) issues.push(`Learning instrument ${instrument} requires an explicit MusicXML/MXL part.`);
      if (instrument === "accordion" && !files.some((file) => file.instrument === "accordion" && file.partKind === "accordion_mapping")) issues.push("Accordion learning requires accordion-mapping.json.");
    }
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
    status: "draft",
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
  report.phase = "failed";
  report.partial = Boolean(report.uploaded.length || report.instrumentParts.length);
  report.issues.push(error instanceof Error ? error.message : String(error));
  return report;
}

export function finishCompensation(report: ImportReport, failedObjects: string[]): ImportReport {
  report.partial = failedObjects.length > 0;
  if (failedObjects.length === 0) {
    report.phase = "compensated";
    report.uploaded = [];
  } else {
    report.issues.push(`Compensation could not remove: ${failedObjects.join(", ")}.`);
  }
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
    phase: "validation",
    readiness: { ready: inspected.issues.length === 0, checks: inspected.issues.length ? [] : ["metadata", "package paths", "magic bytes", "sizes", "checksums", "draft-only policy"] },
    compensated: [],
    processing: { status: inspected.metadata?.learning_enabled ? "pending" : "not-required" },
    checksums: inspected.files.map((file) => ({ file: file.relativePath, checksum: file.checksum })),
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
  const effectiveMapping = { ...(metadata.part_mapping ?? {}) };
  const effectiveFingering = { ...(metadata.fingering_overrides ?? {}) };
  for (const file of inspected.files) {
    if (file.partKind !== "fingering" && file.partKind !== "accordion_mapping") continue;
    const parsed = JSON.parse(file.buffer.toString("utf8")) as Record<string, unknown>;
    if (file.partKind === "accordion_mapping") effectiveMapping.accordion = parsed;
    else if (file.instrument) effectiveFingering[file.instrument] = parsed;
  }
  const effectiveMetadata: ImportMetadata = { ...metadata, status: "draft", part_mapping: effectiveMapping, fingering_overrides: effectiveFingering };
  const lyricsKaFile = inspected.files.find((file) => file.relativePath.toLowerCase() === "lyrics-ka.txt");
  const lyricsEnFile = inspected.files.find((file) => file.relativePath.toLowerCase() === "lyrics-en.txt");
  const canonicalKind = metadata.canonical_source ?? "musicxml";
  const canonicalFile = inspected.files.find((file) => file.fileType === canonicalKind);
  const row = mapMetadataToSongRow(
    effectiveMetadata,
    lyricsKaFile ? cleanupLiteralNewlines(lyricsKaFile.buffer.toString("utf8")) : null,
    lyricsEnFile ? cleanupLiteralNewlines(lyricsEnFile.buffer.toString("utf8")) : null,
    canonicalFile?.checksum ?? null,
  );

  let finalized = false;
  report.phase = "staging";
  try {
    const { data: existingSong, error: existingSongError } = await supabase
      .from("songs").select("id,status").eq("slug", metadata.slug).maybeSingle();
    if (existingSongError) throw existingSongError;
    if (existingSong?.status === "published") throw new Error(`Slug ${metadata.slug} is already published and cannot be imported or overwritten.`);
    if (existingSong && !options.resume) throw new Error(`Draft slug ${metadata.slug} already exists. Re-run with --resume only after reviewing it.`);
    const songId = existingSong ? String(existingSong.id) : randomUUID();
    report.songId = songId;

    const resourceChanges: Record<string, string> = {};
    const packageChecksums = new Set<string>();
    const packageUrls = new Map<string, string>();
    const partRows = new Map<Instrument, Record<string, unknown>>();
    const fileRows: Record<string, unknown>[] = [];
    let processingSource: { bucket: string; object_path: string; sha256: string; format: "musicxml" | "mxl" | "midi"; content_type: string; byte_size: number } | null = null;

    const rememberUrl = (file: PackageFile, publicUrl: string): void => {
      if (file.column) resourceChanges[file.column] = publicUrl;
      if (file.instrument && file.partKind) {
        const current: Record<string, unknown> = partRows.get(file.instrument) ?? {
          song_id: songId,
          instrument: file.instrument,
          fingering_json: file.instrument === "accordion" ? (effectiveMapping.accordion ?? {}) : fingeringFor(effectiveMetadata, file.instrument),
          difficulty: metadata.difficulty ?? null,
        };
        if (file.partKind === "musicxml" || file.partKind === "midi") current[file.partKind === "musicxml" ? "musicxml_url" : "midi_url"] = publicUrl;
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
        .eq("song_id", songId)
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
      if (uploadError) report.reused.push(`${file.relativePath} (existing Storage object)`);
      else report.uploaded.push({ bucket: rule.bucket, path: storagePath, filename: file.relativePath });
      const { data: version, error: versionError } = await supabase
        .from("song_files")
        .select("version")
        .eq("song_id", songId)
        .eq("file_type", file.fileType)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (versionError) throw versionError;
      fileRows.push({
          song_id: songId,
          file_type: file.fileType,
          storage_path: storagePath,
          public_url: publicUrl,
          original_filename: file.relativePath,
          mime_type: file.mimeType,
          file_size: file.buffer.length,
          checksum: file.checksum,
          version: Number(version?.version ?? 0) + 1 + fileRows.filter((entry) => entry.file_type === file.fileType).length,
        });
      rememberUrl(file, publicUrl);
      packageChecksums.add(file.checksum);
      packageUrls.set(file.checksum, publicUrl);
    }

    if (metadata.learning_enabled && canonicalFile) {
      const extension = path.extname(canonicalFile.filename).toLowerCase();
      const format = extension === ".mxl" ? "mxl" : canonicalKind === "midi" ? "midi" : "musicxml";
      let bucket = fileRules[canonicalFile.fileType].bucket;
      let objectPath = storagePathFor(metadata, canonicalFile);
      if (canonicalKind === "musicxml") {
        bucket = "scores";
        objectPath = `${metadata.slug}/${canonicalFile.checksum.slice(0, 12)}-canonical${extension}`;
        const { error } = await supabase.storage.from(bucket).upload(objectPath, canonicalFile.buffer, { contentType: canonicalFile.mimeType, upsert: false });
        if (error && !/already exists/i.test(error.message)) throw error;
        if (error) report.reused.push(`${canonicalFile.relativePath} (existing Learning staging object)`);
        else report.uploaded.push({ bucket, path: objectPath, filename: `${canonicalFile.relativePath} (Learning staging)` });
      }
      processingSource = { bucket, object_path: objectPath, sha256: canonicalFile.checksum, format, content_type: canonicalFile.mimeType, byte_size: canonicalFile.buffer.length };
    }

    const { error: finalizeError } = await supabase.rpc("finalize_song_import", {
      p_song_id: songId,
      p_song: { ...row, ...resourceChanges, id: songId, status: "draft" },
      p_files: fileRows,
      p_parts: [...partRows.values()],
      p_resume: Boolean(existingSong && options.resume),
    });
    if (finalizeError) throw finalizeError;
    finalized = true;
    if (metadata.learning_enabled) {
      const apiUrl = environment.ZURA_LEARNING_API_URL;
      const ownerToken = environment.ZURA_OWNER_ACCESS_TOKEN;
      if (!apiUrl || !ownerToken || !processingSource) throw new Error("Learning import is staged as a private draft; secure Learning API URL/owner session token is required to finish processing.");
      const learning = new ZuraLearningClient({ baseUrl: apiUrl, timeoutMs: 120_000, getAccessToken: async () => ownerToken, retry: { maxRetries: 1, retryWrites: false } });
      const source = processingSource;
      const validation = await learning.validateScore({ song_id: songId, source });
      if (!validation.ok) throw new Error("Learning API validation rejected the canonical source.");
      report.processing = { status: "validated" };
      const processed = await learning.processScore({ song_id: songId, source, publish: false, force: false, midi_mapping: [] });
      report.processing = { status: "complete", manifestKey: processed.manifest.manifest_key, reused: processed.reused };
    }
    const { data: storedParts, error: partsError } = await supabase.from("instrument_parts").select("id,instrument,musicxml_url,midi_url").eq("song_id", songId);
    if (partsError) throw partsError;
    report.instrumentParts = (storedParts ?? []).map((data) => ({ id: String(data.id), instrument: data.instrument as Instrument, musicxmlUrl: data.musicxml_url ? String(data.musicxml_url) : null, midiUrl: data.midi_url ? String(data.midi_url) : null }));
    report.phase = "complete";
    report.readiness = { ready: true, checks: [...report.readiness.checks, "staged uploads", "transactional database finalization", "draft status"] };
    return report;
  } catch (error) {
    markImportFailure(report, error);
    if (metadata.learning_enabled) report.processing = { status: "failed" };
    if (!finalized && options.compensateOnFailure !== false && report.uploaded.length) {
      const failedObjects: string[] = [];
      for (const uploaded of [...report.uploaded].reverse()) {
        const { error: cleanupError } = await supabase.storage.from(uploaded.bucket).remove([uploaded.path]);
        if (cleanupError) failedObjects.push(`${uploaded.bucket}/${uploaded.path}`);
        else report.compensated.push(`${uploaded.bucket}/${uploaded.path}`);
      }
      finishCompensation(report, failedObjects);
    }
    return report;
  }
}

function parseArgs(args: string[]): { packagePath: string | null; dryRun: boolean; resume: boolean } {
  return {
    packagePath: args.find((arg) => !arg.startsWith("--")) ?? null,
    dryRun: args.includes("--dry-run"),
    resume: args.includes("--resume"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.packagePath) {
    console.error("Usage: pnpm import:song -- <song-package-folder> [--dry-run]");
    process.exitCode = 2;
  } else {
    runImport(args.packagePath, args.dryRun, { resume: args.resume })
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
