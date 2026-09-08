import type { Measure, NoteEvent, Timeline } from "./contracts";

export interface ActiveTimingOptions { restThresholdSeconds: number; compressedGapSeconds: number; }
export interface TimeMapSegment { originalStart: number; originalEnd: number; activeStart: number; activeEnd: number; kind: "note" | "gap"; }
export interface ActiveMelodyResult { timeline: Timeline; segments: TimeMapSegment[]; originalToActive(seconds: number): number; activeToOriginal(seconds: number): number; }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function mapWithin(value: number, fromA: number, fromB: number, toA: number, toB: number): number {
  if (fromB <= fromA) return toA;
  return toA + clamp((value - fromA) / (fromB - fromA), 0, 1) * (toB - toA);
}

function mapTime(value: number, segments: TimeMapSegment[], direction: "forward" | "reverse"): number {
  const fromStart = direction === "forward" ? "originalStart" : "activeStart";
  const fromEnd = direction === "forward" ? "originalEnd" : "activeEnd";
  const toStart = direction === "forward" ? "activeStart" : "originalStart";
  const toEnd = direction === "forward" ? "activeEnd" : "originalEnd";
  const segment = segments.find((item) => value >= item[fromStart] && value <= item[fromEnd]) ?? (value < 0 ? segments[0] : segments.at(-1));
  return segment ? mapWithin(value, segment[fromStart], segment[fromEnd], segment[toStart], segment[toEnd]) : 0;
}

export function createActiveMelodyTimeline(source: Timeline, laneNotes: NoteEvent[], options: ActiveTimingOptions = { restThresholdSeconds: 0.6, compressedGapSeconds: 0.2 }): ActiveMelodyResult {
  const notes = [...laneNotes].sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id));
  const segments: TimeMapSegment[] = [];
  const derived: NoteEvent[] = [];
  let originalCursor = 0;
  let activeCursor = 0;
  for (const note of notes) {
    const gap = Math.max(0, note.startSeconds - originalCursor);
    const activeGap = gap > options.restThresholdSeconds ? options.compressedGapSeconds : gap;
    if (gap > 0) segments.push({ originalStart: originalCursor, originalEnd: note.startSeconds, activeStart: activeCursor, activeEnd: activeCursor + activeGap, kind: "gap" });
    activeCursor += activeGap;
    const noteStart = activeCursor;
    const originalEnd = note.startSeconds + note.durationSeconds;
    const derivedEnd = noteStart + note.durationSeconds;
    segments.push({ originalStart: note.startSeconds, originalEnd, activeStart: noteStart, activeEnd: derivedEnd, kind: "note" });
    derived.push({ ...note, startSeconds: noteStart });
    originalCursor = Math.max(originalCursor, originalEnd);
    activeCursor = Math.max(activeCursor, derivedEnd);
  }
  if (originalCursor < source.durationSeconds) {
    const gap = source.durationSeconds - originalCursor;
    const activeGap = gap > options.restThresholdSeconds ? options.compressedGapSeconds : gap;
    segments.push({ originalStart: originalCursor, originalEnd: source.durationSeconds, activeStart: activeCursor, activeEnd: activeCursor + activeGap, kind: "gap" });
    activeCursor += activeGap;
  }
  const measureByIndex = new Map<number, Measure>();
  for (const note of derived) {
    const sourceMeasure = source.measures[note.measureIndex];
    if (!sourceMeasure || measureByIndex.has(note.measureIndex)) continue;
    const start = derived.find((item) => item.measureIndex === note.measureIndex)?.startSeconds ?? note.startSeconds;
    const end = Math.max(...derived.filter((item) => item.measureIndex === note.measureIndex).map((item) => item.startSeconds + item.durationSeconds));
    measureByIndex.set(note.measureIndex, { ...sourceMeasure, startSeconds: start, durationSeconds: Math.max(0, end - start) });
  }
  const measures = source.measures.map((measure) => measureByIndex.get(measure.index) ?? { ...measure, startSeconds: Math.min(activeCursor, segments.find((segment) => segment.originalStart >= measure.startSeconds)?.activeStart ?? activeCursor), durationSeconds: 0 });
  const timeline: Timeline = { ...source, durationSeconds: activeCursor, notes: derived, measures };
  return { timeline, segments, originalToActive: (seconds) => mapTime(seconds, segments, "forward"), activeToOriginal: (seconds) => mapTime(seconds, segments, "reverse") };
}
