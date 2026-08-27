export type UploadFileType = "cover" | "audio" | "midi" | "musicxml" | "score_pdf" | "source_project" | "lyrics" | "instrument_part";

export interface FileRule {
  bucket: "covers" | "audio" | "midi" | "musicxml" | "scores" | "lyrics" | "instrument-parts";
  extensions: string[];
  mimeTypes: string[];
  maxBytes: number;
}

export const fileRules: Record<UploadFileType, FileRule> = {
  cover: { bucket: "covers", extensions: ["jpg", "jpeg", "png", "webp"], mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  audio: { bucket: "audio", extensions: ["mp3"], mimeTypes: ["audio/mpeg", "audio/mp3"], maxBytes: 100 * 1024 * 1024 },
  midi: { bucket: "midi", extensions: ["mid", "midi"], mimeTypes: ["audio/midi", "audio/x-midi", "application/octet-stream"], maxBytes: 5 * 1024 * 1024 },
  musicxml: { bucket: "musicxml", extensions: ["musicxml", "xml", "mxl"], mimeTypes: ["application/vnd.recordare.musicxml+xml", "application/vnd.recordare.musicxml", "application/xml", "text/xml", "application/zip", "application/octet-stream"], maxBytes: 20 * 1024 * 1024 },
  score_pdf: { bucket: "scores", extensions: ["pdf"], mimeTypes: ["application/pdf"], maxBytes: 25 * 1024 * 1024 },
  source_project: { bucket: "instrument-parts", extensions: ["mscz"], mimeTypes: ["application/x-musescore", "application/zip", "application/octet-stream"], maxBytes: 50 * 1024 * 1024 },
  lyrics: { bucket: "lyrics", extensions: ["txt"], mimeTypes: ["text/plain"], maxBytes: 1024 * 1024 },
  instrument_part: { bucket: "instrument-parts", extensions: ["musicxml", "xml", "mxl", "mid", "midi", "json"], mimeTypes: ["application/vnd.recordare.musicxml+xml", "application/vnd.recordare.musicxml", "application/xml", "text/xml", "application/zip", "audio/midi", "audio/x-midi", "application/json", "application/octet-stream"], maxBytes: 20 * 1024 * 1024 },
};

export interface FileLike { name: string; size: number; type: string; }

export function validateFile(file: FileLike, fileType: UploadFileType): string[] {
  const rule = fileRules[fileType];
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const issues: string[] = [];
  if (!rule.extensions.includes(extension)) issues.push(`.${extension || "?"} is not allowed for ${fileType}.`);
  if (file.type && !rule.mimeTypes.includes(file.type.toLowerCase())) issues.push(`${file.type} is not an allowed MIME type for ${fileType}.`);
  if (file.size <= 0) issues.push("The file is empty.");
  if (file.size > rule.maxBytes) issues.push(`The file exceeds the ${Math.round(rule.maxBytes / 1024 / 1024)} MB limit.`);
  return issues;
}

export function safeStorageFilename(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^[-.]+|[-.]+$/g, "").toLowerCase() || "file";
}

export function cleanupLiteralNewlines(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
}
