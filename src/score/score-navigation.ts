import type { NoteEvent, Timeline } from "../learning/contracts";

export interface LogicalPageState { index: number; count: number; top: number; }
export interface ScoreEntryTarget { x: number; y: number; left: number; right: number; top: number; bottom: number; relativePosition: number; sourceTimestamp?: number; midi?: number; }
export interface ScoreMeasureTarget { measureIndex: number; staffIndex: number; left: number; right: number; top: number; bottom: number; entries: ScoreEntryTarget[]; }
export interface ScorePositionRequest { measureIndex: number; relativePosition: number; sourceTimestamp?: number; staffIndex?: number; midi?: number; entryIndex?: number; target?: ScoreMeasureTarget; }
export interface LearningMarkerRequest { noteId: string; measureIndex: number; relativePosition: number; staffIndex?: number; midi: number; }
export interface LearningMarkerTarget { measure: ScoreMeasureTarget; entry: ScoreEntryTarget; entryIndex: number; }
export interface ScoreCoordinateTransform {
  domToSvg(point: { x: number; y: number }): { x: number; y: number };
  svgToOsmd(point: { x: number; y: number }): { x: number; y: number };
}

export function clientToScorePoint(clientX: number, clientY: number, transform: ScoreCoordinateTransform): { x: number; y: number } {
  return transform.svgToOsmd(transform.domToSvg({ x: clientX, y: clientY }));
}

export function logicalPageState(scrollTop: number, viewportHeight: number, contentHeight: number): LogicalPageState {
  const size = Math.max(1, viewportHeight);
  const count = Math.max(1, Math.ceil(Math.max(contentHeight, size) / size));
  const index = Math.max(0, Math.min(count - 1, Math.round(Math.max(0, scrollTop) / size)));
  return { index, count, top: index * size };
}

export function scoreClickRatio(event: Pick<MouseEvent, "clientX" | "clientY">, surface: HTMLElement): number {
  const rect = surface.getBoundingClientRect();
  if (!rect.width || !rect.height) return 0;
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  // Horizontal position refines the nearest score-system location without assuming OSMD page nodes.
  return Math.max(0, Math.min(1, y * 0.92 + x * 0.08));
}

export function resolveCanonicalScorePosition(timeline: Timeline, ratio: number): number {
  const raw = Math.max(0, Math.min(1, ratio)) * timeline.durationSeconds;
  const candidates = [0, timeline.durationSeconds, ...timeline.measures.map((measure) => measure.startSeconds), ...timeline.notes.map((note) => note.startSeconds)];
  return candidates.reduce((closest, candidate) => Math.abs(candidate - raw) < Math.abs(closest - raw) ? candidate : closest, 0);
}

export function nearestScorePosition(x: number, y: number, targets: ScoreMeasureTarget[]): ScorePositionRequest | null {
  if (!targets.length) return null;
  const distance = (target: ScoreMeasureTarget): number => {
    const dx = x < target.left ? target.left - x : x > target.right ? x - target.right : 0;
    const dy = y < target.top ? target.top - y : y > target.bottom ? y - target.bottom : 0;
    return dx * dx + dy * dy;
  };
  const target = [...targets].sort((a, b) => distance(a) - distance(b) || a.measureIndex - b.measureIndex)[0];
  const entryDistance = (entry: ScoreEntryTarget): number => {
    const dx = x < entry.left ? entry.left - x : x > entry.right ? x - entry.right : 0;
    const dy = y < entry.top ? entry.top - y : y > entry.bottom ? y - entry.bottom : 0;
    return dx * dx + dy * dy;
  };
  const entry = target.entries.length
    ? [...target.entries].sort((a, b) => entryDistance(a) - entryDistance(b) || Math.abs(a.x - x) - Math.abs(b.x - x) || a.relativePosition - b.relativePosition)[0]
    : null;
  const relativePosition = entry?.relativePosition ?? Math.max(0, Math.min(1, (x - target.left) / Math.max(1, target.right - target.left)));
  return { measureIndex: target.measureIndex, relativePosition, sourceTimestamp: entry?.sourceTimestamp, staffIndex: target.staffIndex, midi: entry?.midi, entryIndex: entry ? target.entries.indexOf(entry) : undefined, target };
}

export function learningMarkerTarget(request: LearningMarkerRequest, targets: ScoreMeasureTarget[]): LearningMarkerTarget | null {
  const measures = targets.filter((target) => target.measureIndex === request.measureIndex && (request.staffIndex == null || target.staffIndex === request.staffIndex));
  const candidates = (measures.length ? measures : targets.filter((target) => target.measureIndex === request.measureIndex))
    .flatMap((measure) => measure.entries.map((entry, entryIndex) => ({ measure, entry, entryIndex })));
  return candidates.sort((a, b) => {
    const aTime = Math.abs(a.entry.relativePosition - request.relativePosition);
    const bTime = Math.abs(b.entry.relativePosition - request.relativePosition);
    if (aTime !== bTime) return aTime - bTime;
    const aPitch = a.entry.midi == null ? 128 : Math.abs(a.entry.midi - request.midi);
    const bPitch = b.entry.midi == null ? 128 : Math.abs(b.entry.midi - request.midi);
    return aPitch - bPitch || a.entryIndex - b.entryIndex;
  })[0] ?? null;
}

export function resolveCanonicalScoreLocation(timeline: Timeline, request: ScorePositionRequest): { seconds: number; noteId: string | null; cursorStep: number | null } {
  const measure = timeline.measures[request.measureIndex];
  if (!measure) return { seconds: 0, noteId: null, cursorStep: null };
  const raw = measure.startSeconds + Math.max(0, Math.min(1, request.relativePosition)) * measure.durationSeconds;
  const measureNotes = timeline.notes.filter((note) => note.measureIndex === request.measureIndex);
  const staffNotes = request.staffIndex == null ? [] : measureNotes.filter((note) => note.staff === request.staffIndex! + 1);
  const notes = staffNotes.length ? staffNotes : measureNotes;
  const note = notes.reduce<NoteEvent | null>((closest, candidate) => {
    if (!closest) return candidate;
    const candidateTime = Math.abs(candidate.startSeconds - raw);
    const closestTime = Math.abs(closest.startSeconds - raw);
    if (candidateTime !== closestTime) return candidateTime < closestTime ? candidate : closest;
    if (request.midi != null) return Math.abs(candidate.midi - request.midi) < Math.abs(closest.midi - request.midi) ? candidate : closest;
    return closest;
  }, null);
  return note ? { seconds: note.startSeconds, noteId: note.id, cursorStep: note.cursorStep ?? timeline.notes.indexOf(note) } : { seconds: measure.startSeconds, noteId: null, cursorStep: null };
}
