import type { KaraokeArtifactManifest, LyricAlignment, LyricLine } from "./contracts";

export const MANUAL_SYNC_SCHEMA_VERSION = 1 as const;
export const MANUAL_SYNC_STORAGE_PREFIX = "zura:karaoke-manual-sync:";

export interface ManualLineOverride { lineId: string; startSeconds: number; syncedAt: string; }
export interface ManualSyncIdentity { songId: string; slug: string; sourceAudioSha256: string; authoritativeText: string; }
export interface ManualSyncDraft extends ManualSyncIdentity {
  schemaVersion: typeof MANUAL_SYNC_SCHEMA_VERSION;
  originalTimingSource: LyricAlignment["source"];
  createdAt: string;
  updatedAt: string;
  status: "in-progress" | "review" | "approved";
  approvedAt: string | null;
  overrides: ManualLineOverride[];
}
export interface ManualSyncSession { draft: ManualSyncDraft; undo: ManualLineOverride[][]; }
export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export type ManualSyncResult = { ok: true; session: ManualSyncSession; selectedLineId: string } | { ok: false; message: string };
export type FinishSyncResult = { ok: true; session: ManualSyncSession; serialized: string; firstLineId: string; firstStartSeconds: number } | { ok: false; message: string };
export interface SyncLyricAnalysis { lineId: string; sourceLineNumber: number; sourceText: string; displayText: string; status: "syncable" | "production-only" | "needs-review" | "non-lyric"; productionDirections: string[]; }

const roundTime = (seconds: number): number => Math.round(seconds * 1000) / 1000;
const directionSegment = /\[[^\]\r\n]*\]/gu;

export function analyzeSyncLyricLine(line: Pick<LyricLine, "id" | "text">, sourceLineNumber = 1): SyncLyricAnalysis {
  const productionDirections = line.text.match(directionSegment) ?? [];
  const withoutCompleteSegments = line.text.replace(directionSegment, " ");
  if (withoutCompleteSegments.includes("[")) return { lineId: line.id, sourceLineNumber, sourceText: line.text, displayText: "", status: "needs-review", productionDirections };
  const displayText = withoutCompleteSegments.replace(/^[\s–—:;|/\\]+|[\s–—:;|/\\]+$/gu, "").replace(/\s{2,}/gu, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(displayText)) return { lineId: line.id, sourceLineNumber, sourceText: line.text, displayText: "", status: productionDirections.length ? "production-only" : "non-lyric", productionDirections };
  return { lineId: line.id, sourceLineNumber, sourceText: line.text, displayText, status: "syncable", productionDirections };
}

export function analyzeSyncLyrics(alignment: LyricAlignment): SyncLyricAnalysis[] { return alignment.lines.map((line, index) => analyzeSyncLyricLine(line, index + 1)); }
export const isSungLyricLine = (line: Pick<LyricLine, "id" | "text">): boolean => analyzeSyncLyricLine(line).status === "syncable";
export const sungLines = (alignment: LyricAlignment): LyricLine[] => alignment.lines.filter(isSungLyricLine);
export function syncDisplayText(alignment: LyricAlignment, lineId: string): string { const index = alignment.lines.findIndex((line) => line.id === lineId); return index < 0 ? "" : analyzeSyncLyricLine(alignment.lines[index], index + 1).displayText; }

export function nextSungLineId(alignment: LyricAlignment, lineId: string): string {
  const lines = sungLines(alignment); const index = lines.findIndex((line) => line.id === lineId);
  return lines[index + 1]?.id ?? lineId;
}

export function createManualSyncSession(manifest: KaraokeArtifactManifest, now = new Date().toISOString()): ManualSyncSession {
  return { draft: { schemaVersion: MANUAL_SYNC_SCHEMA_VERSION, songId: manifest.songId, slug: manifest.slug, sourceAudioSha256: manifest.sourceAudioSha256, authoritativeText: manifest.alignment.authoritativeText, originalTimingSource: manifest.alignment.source, createdAt: now, updatedAt: now, status: "in-progress", approvedAt: null, overrides: [] }, undo: [] };
}

function orderedOverrides(alignment: LyricAlignment, overrides: readonly ManualLineOverride[]): ManualLineOverride[] {
  const order = new Map(alignment.lines.map((line, index) => [line.id, index]));
  return [...overrides].sort((left, right) => (order.get(left.lineId) ?? Infinity) - (order.get(right.lineId) ?? Infinity));
}

function validateOverrideOrder(alignment: LyricAlignment, overrides: readonly ManualLineOverride[]): string | null {
  const ordered = orderedOverrides(alignment, overrides);
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!Number.isFinite(current.startSeconds) || current.startSeconds < 0) return `Manual time for ${current.lineId} is invalid.`;
    if (index > 0 && ordered[index - 1].startSeconds >= current.startSeconds) return `Manual time for ${current.lineId} must be after ${ordered[index - 1].lineId}.`;
  }
  return null;
}

export function syncLyricLine(session: ManualSyncSession, alignment: LyricAlignment, lineId: string, currentTime: number, now = new Date().toISOString()): ManualSyncResult {
  const line = alignment.lines.find((item) => item.id === lineId);
  if (!line || !isSungLyricLine(line)) return { ok: false, message: "Select a sung lyric line before synchronizing." };
  if (!Number.isFinite(currentTime) || currentTime < 0) return { ok: false, message: "The audio playback time is invalid." };
  if (!(line.endSeconds > line.startSeconds)) return { ok: false, message: `Line ${lineId} has no valid existing duration.` };
  const override = { lineId, startSeconds: roundTime(currentTime), syncedAt: now };
  const candidate = session.draft.overrides.filter((item) => item.lineId !== lineId).concat(override);
  const orderError = validateOverrideOrder(alignment, candidate);
  if (orderError) return { ok: false, message: orderError };
  return { ok: true, session: { draft: { ...session.draft, status: "in-progress", approvedAt: null, updatedAt: now, overrides: orderedOverrides(alignment, candidate) }, undo: [...session.undo, session.draft.overrides.map((item) => ({ ...item }))] }, selectedLineId: nextSungLineId(alignment, lineId) };
}

export function clearManualSync(session: ManualSyncSession, alignment: LyricAlignment, lineId: string, now = new Date().toISOString()): ManualSyncSession {
  if (!session.draft.overrides.some((item) => item.lineId === lineId)) return session;
  return { draft: { ...session.draft, status: "in-progress", approvedAt: null, updatedAt: now, overrides: orderedOverrides(alignment, session.draft.overrides.filter((item) => item.lineId !== lineId)) }, undo: [...session.undo, session.draft.overrides.map((item) => ({ ...item }))] };
}

export function undoManualSync(session: ManualSyncSession, now = new Date().toISOString()): ManualSyncSession {
  const previous = session.undo.at(-1); if (!previous) return session;
  return { draft: { ...session.draft, status: "in-progress", approvedAt: null, updatedAt: now, overrides: previous.map((item) => ({ ...item })) }, undo: session.undo.slice(0, -1) };
}

export function applyManualSyncPreview(alignment: LyricAlignment, overrides: readonly ManualLineOverride[]): LyricAlignment {
  const copy = structuredClone(alignment); const overrideById = new Map(overrides.map((item) => [item.lineId, item])); const ordered = orderedOverrides(alignment, overrides);
  copy.lines = copy.lines.flatMap((line, index) => {
    const analysis = analyzeSyncLyricLine(line, index + 1);
    if (analysis.status !== "syncable") return [];
    if (analysis.productionDirections.length) { line.text = analysis.displayText; line.words = []; }
    return [line];
  });
  for (const line of copy.lines) {
    const override = overrideById.get(line.id); if (!override) continue;
    const delta = override.startSeconds - line.startSeconds; line.startSeconds = override.startSeconds; line.endSeconds += delta;
    for (const word of line.words) { word.startSeconds += delta; word.endSeconds += delta; for (const syllable of word.syllables) { syllable.startSeconds += delta; syllable.endSeconds += delta; } }
    const currentIndex = ordered.findIndex((item) => item.lineId === line.id); const nextManualStart = ordered[currentIndex + 1]?.startSeconds;
    if (nextManualStart !== undefined) line.endSeconds = nextManualStart;
  }
  copy.source = overrides.length ? "manual" : alignment.source; return copy;
}

export const exportManualSyncDraft = (session: ManualSyncSession): string => `${JSON.stringify(session.draft, null, 2)}\n`;

export function importManualSyncDraft(raw: string, manifest: KaraokeArtifactManifest): ManualSyncSession {
  const value = JSON.parse(raw) as Partial<ManualSyncDraft>;
  if (value.schemaVersion !== MANUAL_SYNC_SCHEMA_VERSION) throw new Error("Unsupported manual-sync draft schema.");
  const expected: ManualSyncIdentity = { songId: manifest.songId, slug: manifest.slug, sourceAudioSha256: manifest.sourceAudioSha256, authoritativeText: manifest.alignment.authoritativeText };
  for (const key of Object.keys(expected) as Array<keyof ManualSyncIdentity>) if (value[key] !== expected[key]) throw new Error(`Manual-sync draft ${key} does not match this song.`);
  if (!Array.isArray(value.overrides) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || typeof value.originalTimingSource !== "string" || !["in-progress", "review", "approved"].includes(value.status ?? "")) throw new Error("Manual-sync draft is incomplete.");
  if (value.originalTimingSource !== manifest.alignment.source) throw new Error("Manual-sync draft timing source does not match this manifest.");
  if (value.status === "approved" && typeof value.approvedAt !== "string") throw new Error("Approved manual-sync draft has no approval timestamp.");
  const seen = new Set<string>(); const migratedOverrides: ManualLineOverride[] = [];
  for (const override of value.overrides) {
    const line = manifest.alignment.lines.find((item) => item.id === override.lineId);
    if (!line || seen.has(override.lineId) || typeof override.syncedAt !== "string") throw new Error("Manual-sync draft contains an unknown or duplicate lyric-line override.");
    seen.add(override.lineId);
    if (isSungLyricLine(line)) migratedOverrides.push(override);
  }
  const orderError = validateOverrideOrder(manifest.alignment, migratedOverrides); if (orderError) throw new Error(orderError);
  return { draft: { ...(value as ManualSyncDraft), overrides: migratedOverrides }, undo: [] };
}

export function manualSyncStorageKey(manifest: KaraokeArtifactManifest): string { return `${MANUAL_SYNC_STORAGE_PREFIX}${encodeURIComponent(manifest.songId)}:${encodeURIComponent(manifest.slug)}:${manifest.sourceAudioSha256}:${manifest.alignment.source}`; }
export function saveManualSyncDraft(storage: DraftStorage, manifest: KaraokeArtifactManifest, session: ManualSyncSession): void { storage.setItem(manualSyncStorageKey(manifest), exportManualSyncDraft(session)); }
export function restoreManualSyncDraft(storage: DraftStorage, manifest: KaraokeArtifactManifest): ManualSyncSession | null { const raw = storage.getItem(manualSyncStorageKey(manifest)); if (!raw) return null; try { return importManualSyncDraft(raw, manifest); } catch { return null; } }
export function discardManualSyncDraft(storage: DraftStorage, manifest: KaraokeArtifactManifest): void { storage.removeItem(manualSyncStorageKey(manifest)); }
export function manualSyncProgress(session: ManualSyncSession, alignment: LyricAlignment): { synced: number; total: number } { const valid = new Set(sungLines(alignment).map((line) => line.id)); return { synced: session.draft.overrides.filter((item) => valid.has(item.lineId)).length, total: valid.size }; }

export function finishManualSync(session: ManualSyncSession, manifest: KaraokeArtifactManifest, now = new Date().toISOString()): FinishSyncResult {
  const lines = sungLines(manifest.alignment); const progress = manualSyncProgress(session, manifest.alignment);
  if (!lines.length || progress.synced !== progress.total) return { ok: false, message: `Synchronize all ${progress.total} sung lines before review.` };
  try {
    const roundTrip = importManualSyncDraft(exportManualSyncDraft(session), manifest); const preview = applyManualSyncPreview(manifest.alignment, roundTrip.draft.overrides);
    for (const line of lines) { const timed = preview.lines.find((item) => item.id === line.id); if (!timed || !(timed.endSeconds > timed.startSeconds)) return { ok: false, message: `Line ${line.id} has a non-positive timing window.` }; }
    const reviewed: ManualSyncSession = { draft: { ...roundTrip.draft, status: "review", approvedAt: null, updatedAt: now }, undo: session.undo };
    const serialized = exportManualSyncDraft(reviewed); importManualSyncDraft(serialized, manifest);
    const first = reviewed.draft.overrides[0]; return { ok: true, session: reviewed, serialized, firstLineId: first.lineId, firstStartSeconds: first.startSeconds };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "The local draft could not be validated." }; }
}

export function reviewLineTarget(session: ManualSyncSession, alignment: LyricAlignment, lineId: string, direction: "previous" | "current" | "next"): { lineId: string; startSeconds: number } | null {
  const ordered = orderedOverrides(alignment, session.draft.overrides); const index = ordered.findIndex((item) => item.lineId === lineId); if (index < 0) return null;
  const target = ordered[Math.max(0, Math.min(ordered.length - 1, index + (direction === "previous" ? -1 : direction === "next" ? 1 : 0)))]; return { lineId: target.lineId, startSeconds: target.startSeconds };
}
export function fixManualSyncLine(session: ManualSyncSession, lineId: string, now = new Date().toISOString()): ManualSyncSession { if (!session.draft.overrides.some((item) => item.lineId === lineId)) return session; return { ...session, draft: { ...session.draft, status: "in-progress", approvedAt: null, updatedAt: now } }; }
export function approveManualSync(session: ManualSyncSession, now = new Date().toISOString()): ManualSyncSession { return { ...session, draft: { ...session.draft, status: "approved", approvedAt: now, updatedAt: now } }; }

export function isManualSyncShortcut(event: Pick<KeyboardEvent, "key" | "target" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null; const tagName = target?.tagName?.toUpperCase() ?? "";
  return event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey && !event.altKey && tagName !== "INPUT" && tagName !== "TEXTAREA" && target?.isContentEditable !== true;
}
