export interface BrowserBatchEntry { path: string; expectedSlug: string; resume?: boolean; }
export interface BrowserBatchManifest { schema: "zura-song-batch/v1"; concurrency?: number; packages: BrowserBatchEntry[]; }
export interface BatchReadiness { valid: boolean; manifest: BrowserBatchManifest | null; errors: Array<{ song: string; message: string }>; }

export function validateBatchManifest(value: unknown): BatchReadiness {
  const errors: BatchReadiness["errors"] = [];
  if (!value || typeof value !== "object") return { valid: false, manifest: null, errors: [{ song: "batch", message: "Manifest must be a JSON object." }] };
  const manifest = value as Partial<BrowserBatchManifest>;
  if (manifest.schema !== "zura-song-batch/v1") errors.push({ song: "batch", message: "Unsupported schema; expected zura-song-batch/v1." });
  if (!Array.isArray(manifest.packages) || !manifest.packages.length) errors.push({ song: "batch", message: "At least one package is required." });
  if (manifest.concurrency !== undefined && (!Number.isInteger(manifest.concurrency) || manifest.concurrency < 1 || manifest.concurrency > 4)) errors.push({ song: "batch", message: "Concurrency must be between 1 and 4." });
  const entries = Array.isArray(manifest.packages) ? manifest.packages : [];
  entries.forEach((entry, index) => {
    const label = typeof entry?.expectedSlug === "string" ? entry.expectedSlug : `packages[${index}]`;
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) errors.push({ song: label, message: "Package path is required." });
    if (!entry || typeof entry.expectedSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.expectedSlug)) errors.push({ song: label, message: "Expected slug is invalid." });
    if (entry?.resume !== undefined && typeof entry.resume !== "boolean") errors.push({ song: label, message: "resume must be boolean." });
  });
  const slugs = entries.map((entry) => entry.expectedSlug);
  if (new Set(slugs).size !== slugs.length) errors.push({ song: "batch", message: "Duplicate slugs are not allowed." });
  const paths = entries.map((entry) => String(entry.path ?? "").toLocaleLowerCase());
  if (new Set(paths).size !== paths.length) errors.push({ song: "batch", message: "Duplicate package paths are not allowed." });
  return { valid: errors.length === 0, manifest: errors.length ? null : manifest as BrowserBatchManifest, errors };
}

export function parseBatchManifest(text: string): BatchReadiness {
  try { return validateBatchManifest(JSON.parse(text)); }
  catch { return { valid: false, manifest: null, errors: [{ song: "batch", message: "Manifest contains invalid JSON." }] }; }
}
