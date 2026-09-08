import type { NoteEvent, Timeline } from "../learning/contracts";

export interface LogicalPageState { index: number; count: number; top: number; }
export interface ScoreMeasureTarget { measureIndex: number; left: number; right: number; top: number; bottom: number; entries: Array<{ x: number; relativePosition: number }>; }
export interface ScorePositionRequest { measureIndex: number; relativePosition: number; }

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
  const relativePosition = target.entries.length
    ? [...target.entries].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || a.relativePosition - b.relativePosition)[0].relativePosition
    : Math.max(0, Math.min(1, (x - target.left) / Math.max(1, target.right - target.left)));
  return { measureIndex: target.measureIndex, relativePosition };
}

export function resolveCanonicalScoreLocation(timeline: Timeline, request: ScorePositionRequest): { seconds: number; noteId: string | null; cursorStep: number | null } {
  const measure = timeline.measures[request.measureIndex];
  if (!measure) return { seconds: 0, noteId: null, cursorStep: null };
  const raw = measure.startSeconds + Math.max(0, Math.min(1, request.relativePosition)) * measure.durationSeconds;
  const notes = timeline.notes.filter((note) => note.measureIndex === request.measureIndex);
  const note = notes.reduce<NoteEvent | null>((closest, candidate) => !closest || Math.abs(candidate.startSeconds - raw) < Math.abs(closest.startSeconds - raw) ? candidate : closest, null);
  return note ? { seconds: note.startSeconds, noteId: note.id, cursorStep: note.cursorStep ?? timeline.notes.indexOf(note) } : { seconds: measure.startSeconds, noteId: null, cursorStep: null };
}
