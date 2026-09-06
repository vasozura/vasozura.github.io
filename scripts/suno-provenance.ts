import path from "node:path";

export type SunoGenerationRole = "canonical" | "alternate";
export type SunoMatchConfidence = "exact" | "high" | "review-required" | "unmatched";
export type OwnerConfirmationState = "pending" | "confirmed";

export interface SunoLocalMediaIdentity {
  filename: string;
  sha256: string;
  duration_seconds: number;
  confidence: SunoMatchConfidence;
}

export interface SunoGenerationProvenance {
  generation_id: string;
  url: string;
  title: string;
  role: SunoGenerationRole;
  source_created_at_text: string | null;
  duration_seconds: number;
  style_prompt: string | null;
  local_media: SunoLocalMediaIdentity | null;
  matching_evidence: string[];
}

export interface SunoPackageProvenance {
  schema_version: "zura-suno-provenance/v1";
  source_index: number;
  canonical: SunoGenerationProvenance;
  alternates: SunoGenerationProvenance[];
  owner_confirmation: {
    composer: OwnerConfirmationState;
    lyricist: OwnerConfirmationState;
    translator: OwnerConfirmationState;
    recording_rights: OwnerConfirmationState;
    publication_rights: OwnerConfirmationState;
    final_mp3: OwnerConfirmationState;
    learning_mode: OwnerConfirmationState;
  };
  readiness: {
    status: "owner-review-required" | "approved";
    blockers: string[];
  };
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const checksumPattern = /^[a-f0-9]{64}$/;
const allowedTopLevel = new Set(["schema_version", "source_index", "canonical", "alternates", "owner_confirmation", "readiness"]);
const allowedGeneration = new Set(["generation_id", "url", "title", "role", "source_created_at_text", "duration_seconds", "style_prompt", "local_media", "matching_evidence"]);
const allowedLocalMedia = new Set(["filename", "sha256", "duration_seconds", "confidence"]);
const confirmationKeys = ["composer", "lyricist", "translator", "recording_rights", "publication_rights", "final_mp3", "learning_mode"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, prefix: string, issues: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${prefix}.${key} is not supported.`);
}

function validateLocalMedia(value: unknown, prefix: string, required: boolean, issues: string[]): SunoLocalMediaIdentity | null {
  if (value === null && !required) return null;
  if (!isObject(value)) {
    issues.push(`${prefix} must be an object${required ? "" : " or null"}.`);
    return null;
  }
  rejectUnknownKeys(value, allowedLocalMedia, prefix, issues);
  const filename = value.filename;
  if (typeof filename !== "string" || !filename || path.basename(filename) !== filename || /[\\/:]/.test(filename)) {
    issues.push(`${prefix}.filename must be a basename without a local path.`);
  }
  if (typeof value.sha256 !== "string" || !checksumPattern.test(value.sha256)) issues.push(`${prefix}.sha256 must be a lowercase SHA-256.`);
  if (typeof value.duration_seconds !== "number" || !Number.isFinite(value.duration_seconds) || value.duration_seconds <= 0) issues.push(`${prefix}.duration_seconds must be positive.`);
  if (!(["exact", "high", "review-required", "unmatched"] as unknown[]).includes(value.confidence)) issues.push(`${prefix}.confidence is invalid.`);
  return value as unknown as SunoLocalMediaIdentity;
}

function validateGeneration(value: unknown, expectedRole: SunoGenerationRole, prefix: string, issues: string[]): SunoGenerationProvenance | null {
  if (!isObject(value)) {
    issues.push(`${prefix} must be an object.`);
    return null;
  }
  rejectUnknownKeys(value, allowedGeneration, prefix, issues);
  const id = value.generation_id;
  if (typeof id !== "string" || !uuidPattern.test(id)) issues.push(`${prefix}.generation_id must be a UUID.`);
  const expectedUrl = typeof id === "string" ? `https://suno.com/song/${id}` : "";
  if (value.url !== expectedUrl) issues.push(`${prefix}.url must be the canonical public Suno song URL for its generation ID.`);
  if (typeof value.title !== "string" || !value.title.trim()) issues.push(`${prefix}.title is required.`);
  if (value.role !== expectedRole) issues.push(`${prefix}.role must be ${expectedRole}.`);
  if (value.source_created_at_text !== null && typeof value.source_created_at_text !== "string") issues.push(`${prefix}.source_created_at_text must be a string or null.`);
  if (typeof value.duration_seconds !== "number" || !Number.isFinite(value.duration_seconds) || value.duration_seconds <= 0) issues.push(`${prefix}.duration_seconds must be positive.`);
  if (value.style_prompt !== null && typeof value.style_prompt !== "string") issues.push(`${prefix}.style_prompt must be a string or null.`);
  if (!Array.isArray(value.matching_evidence) || !value.matching_evidence.length || value.matching_evidence.some((entry) => typeof entry !== "string" || !entry.trim())) {
    issues.push(`${prefix}.matching_evidence must contain non-empty strings.`);
  } else if (value.matching_evidence.some((entry) => /https?:\/\//i.test(entry))) {
    issues.push(`${prefix}.matching_evidence must not contain media or signed URLs.`);
  }
  validateLocalMedia(value.local_media, `${prefix}.local_media`, expectedRole === "canonical", issues);
  return value as unknown as SunoGenerationProvenance;
}

export function validateSunoProvenance(value: unknown): { provenance: SunoPackageProvenance | null; issues: string[] } {
  const issues: string[] = [];
  if (!isObject(value)) return { provenance: null, issues: ["suno-provenance.json must contain an object."] };
  rejectUnknownKeys(value, allowedTopLevel, "suno-provenance", issues);
  if (value.schema_version !== "zura-suno-provenance/v1") issues.push("suno-provenance.schema_version must be zura-suno-provenance/v1.");
  if (!Number.isInteger(value.source_index) || Number(value.source_index) < 1) issues.push("suno-provenance.source_index must be a positive integer.");
  const canonical = validateGeneration(value.canonical, "canonical", "suno-provenance.canonical", issues);
  const alternates: SunoGenerationProvenance[] = [];
  if (!Array.isArray(value.alternates)) issues.push("suno-provenance.alternates must be an array.");
  else value.alternates.forEach((entry, index) => {
    const alternate = validateGeneration(entry, "alternate", `suno-provenance.alternates[${index}]`, issues);
    if (alternate) alternates.push(alternate);
  });
  const ids = [canonical?.generation_id, ...alternates.map((entry) => entry.generation_id)].filter(Boolean) as string[];
  if (new Set(ids).size !== ids.length) issues.push("suno-provenance generation IDs must be unique.");

  if (!isObject(value.owner_confirmation)) issues.push("suno-provenance.owner_confirmation must be an object.");
  else {
    rejectUnknownKeys(value.owner_confirmation, new Set(confirmationKeys), "suno-provenance.owner_confirmation", issues);
    for (const key of confirmationKeys) if (!(["pending", "confirmed"] as unknown[]).includes(value.owner_confirmation[key])) issues.push(`suno-provenance.owner_confirmation.${key} must be pending or confirmed.`);
  }
  if (!isObject(value.readiness)) issues.push("suno-provenance.readiness must be an object.");
  else {
    rejectUnknownKeys(value.readiness, new Set(["status", "blockers"]), "suno-provenance.readiness", issues);
    if (!(["owner-review-required", "approved"] as unknown[]).includes(value.readiness.status)) issues.push("suno-provenance.readiness.status is invalid.");
    if (!Array.isArray(value.readiness.blockers) || value.readiness.blockers.some((entry) => typeof entry !== "string" || !entry.trim())) issues.push("suno-provenance.readiness.blockers must be an array of non-empty strings.");
  }
  return { provenance: issues.length ? null : value as unknown as SunoPackageProvenance, issues };
}

export function mapSunoProvenanceRows(provenance: SunoPackageProvenance): Record<string, unknown>[] {
  return [provenance.canonical, ...provenance.alternates].map((generation) => ({
    generation_id: generation.generation_id,
    generation_url: generation.url,
    title: generation.title,
    relationship: generation.role,
    source_created_at_text: generation.source_created_at_text,
    duration_seconds: generation.duration_seconds,
    style_prompt: generation.style_prompt,
    local_media_filename: generation.local_media?.filename ?? null,
    local_media_sha256: generation.local_media?.sha256 ?? null,
    local_media_duration_seconds: generation.local_media?.duration_seconds ?? null,
    match_confidence: generation.local_media?.confidence ?? null,
    evidence: generation.matching_evidence,
  }));
}
