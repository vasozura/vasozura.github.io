import type { Timeline } from "../learning/contracts";

export interface LogicalPageState { index: number; count: number; top: number; }

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
