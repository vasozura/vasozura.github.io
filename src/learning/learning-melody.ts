import type { NoteEvent, Timeline } from "./contracts";
import type { VoiceLane } from "./voice-lanes";
import { createActiveMelodyTimeline, type ActiveMelodyResult } from "./active-melody";

export type MelodyProvenance = "Vocal" | "Lead" | "Manual reference" | "Inferred" | "Musical rest";
export interface LearningMelodyEvent extends NoteEvent { learningId: string; sourceNoteId: string; sourceLaneId: string; provenance: MelodyProvenance; }
export interface LearningMelodySegment { id: string; startSeconds: number; endSeconds: number; sourceLaneId: string | null; sourceLabel: string; provenance: MelodyProvenance; noteCount: number; retainedRest: boolean; }
export interface LearningMelodyDiagnostics { durationSeconds: number; noteCount: number; longestSilentGapSeconds: number; longestUnintendedGapSeconds: number; medianSilentGapSeconds: number; pitchMin: number | null; pitchMax: number | null; monophonyRatio: number; continuityWarning: boolean; }
export interface LearningMelody { timeline: Timeline; notes: LearningMelodyEvent[]; segments: LearningMelodySegment[]; diagnostics: LearningMelodyDiagnostics; primaryLaneId: string | null; }
export interface LearningMelodyOptions { primaryLane?: VoiceLane | null; manualPrimary?: boolean; gapFillLane?: VoiceLane | null; gapThresholdSeconds?: number; retainedRestIds?: ReadonlySet<string>; }

const sorted = (notes: NoteEvent[]): NoteEvent[] => [...notes].sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi || a.id.localeCompare(b.id));
const median = (values: number[]): number => { const list = [...values].sort((a, b) => a - b); return list[Math.floor(list.length / 2)] ?? 0; };

export function selectGapFillLane(lanes: VoiceLane[]): VoiceLane | null {
  const eligible = lanes.filter((lane) => lane.notes.length > 3 && !/(bass|drum|percussion|chord|harmony|pad)/i.test(lane.partName));
  const explicitLead = eligible.filter((lane) => /(lead|melody|solo|guitar|violin|flute|sax)/i.test(lane.partName));
  return [...(explicitLead.length ? explicitLead : eligible)].sort((a, b) => {
    const aPitch = median(a.notes.map((note) => note.midi));
    const bPitch = median(b.notes.map((note) => note.midi));
    const aSteps = a.notes.slice(1).filter((note, index) => Math.abs(note.midi - a.notes[index].midi) <= 9).length / Math.max(1, a.notes.length - 1);
    const bSteps = b.notes.slice(1).filter((note, index) => Math.abs(note.midi - b.notes[index].midi) <= 9).length / Math.max(1, b.notes.length - 1);
    return bSteps - aSteps || bPitch - aPitch || b.notes.length - a.notes.length || a.id.localeCompare(b.id);
  })[0] ?? null;
}

function provenance(lane: VoiceLane, manual: boolean): MelodyProvenance {
  if (manual) return "Manual reference";
  if (/(^|\b)(vocals?|voice|singer)(\b|$)/i.test(lane.partName)) return "Vocal";
  if (/(^|\b)(lead|melody|solo)(\b|$)/i.test(lane.partName)) return "Lead";
  return lane.inferred ? "Inferred" : "Lead";
}

function oneContinuousLine(notes: NoteEvent[]): NoteEvent[] {
  const groups = new Map<number, NoteEvent[]>();
  for (const note of sorted(notes)) {
    const key = Math.round(note.startSeconds * 1000);
    const group = groups.get(key) ?? [];
    group.push(note); groups.set(key, group);
  }
  let previous = 60;
  return [...groups.values()].map((group) => {
    const winner = [...group].sort((a, b) => Math.abs(a.midi - previous) - Math.abs(b.midi - previous) || b.midi - a.midi || a.id.localeCompare(b.id))[0];
    previous = winner.midi;
    return winner;
  });
}

function diagnostics(notes: LearningMelodyEvent[], durationSeconds: number, retained: readonly Pick<LearningMelodySegment, "startSeconds" | "endSeconds" | "retainedRest">[] = []): LearningMelodyDiagnostics {
  const sequence = sorted(notes);
  const gapRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let overlaps = 0;
  for (const note of sequence) {
    if (note.startSeconds > cursor) gapRanges.push({ start: cursor, end: note.startSeconds });
    if (note.startSeconds < cursor - 0.01) overlaps += 1;
    cursor = Math.max(cursor, note.startSeconds + note.durationSeconds);
  }
  if (cursor < durationSeconds) gapRanges.push({ start: cursor, end: durationSeconds });
  const gaps = gapRanges.map((gap) => gap.end - gap.start);
  const longestSilentGapSeconds = Math.max(0, ...gaps);
  const unintended = gapRanges.filter((gap) => !retained.some((segment) => segment.retainedRest && segment.startSeconds <= gap.start + 0.01 && segment.endSeconds >= gap.end - 0.01)).map((gap) => gap.end - gap.start);
  const longestUnintendedGapSeconds = Math.max(0, ...unintended);
  return { durationSeconds, noteCount: sequence.length, longestSilentGapSeconds, longestUnintendedGapSeconds, medianSilentGapSeconds: median(gaps), pitchMin: sequence.length ? Math.min(...sequence.map((note) => note.midi)) : null, pitchMax: sequence.length ? Math.max(...sequence.map((note) => note.midi)) : null, monophonyRatio: sequence.length ? 1 - overlaps / sequence.length : 1, continuityWarning: longestUnintendedGapSeconds > 1 };
}

function learningEvent(note: NoteEvent, lane: VoiceLane, source: MelodyProvenance, index: number): LearningMelodyEvent {
  return { ...note, id: `learning-${index}-${note.id}`, learningId: `learning-${index}-${note.id}`, sourceNoteId: note.id, sourceLaneId: lane.id, provenance: source };
}

export function composeLearningMelody(canonical: Timeline, lanes: VoiceLane[], options: LearningMelodyOptions = {}): LearningMelody {
  const primary = options.primaryLane ?? lanes[0] ?? null;
  if (!primary) return { timeline: { ...canonical, notes: [] }, notes: [], segments: [], diagnostics: diagnostics([], canonical.durationSeconds), primaryLaneId: null };
  const threshold = options.gapThresholdSeconds ?? 1;
  const primaryNotes = oneContinuousLine(primary.notes);
  const primarySource = provenance(primary, options.manualPrimary ?? false);
  const candidates = lanes.filter((lane) => lane.id !== primary.id);
  const intervals: Array<{ start: number; end: number; kind: "primary" | "gap" }> = [];
  let cursor = 0;
  for (const note of primaryNotes) {
    if (note.startSeconds - cursor > threshold) intervals.push({ start: cursor, end: note.startSeconds, kind: "gap" });
    const primaryStart = Math.max(cursor, note.startSeconds);
    const primaryEnd = note.startSeconds + note.durationSeconds;
    const last = intervals.at(-1);
    if (last?.kind === "primary" && primaryStart - last.end <= threshold) last.end = Math.max(last.end, primaryEnd);
    else intervals.push({ start: primaryStart, end: primaryEnd, kind: "primary" });
    cursor = Math.max(cursor, primaryEnd);
  }
  if (canonical.durationSeconds - cursor > threshold) intervals.push({ start: cursor, end: canonical.durationSeconds, kind: "gap" });
  const notes: LearningMelodyEvent[] = [];
  const segments: LearningMelodySegment[] = [];
  for (const [segmentIndex, interval] of intervals.entries()) {
    const availableFillLanes = candidates.filter((candidate) => candidate.notes.some((note) => note.startSeconds >= interval.start - 0.01 && note.startSeconds < interval.end - 0.01));
    const lane = interval.kind === "primary" ? primary : options.gapFillLane ?? selectGapFillLane(availableFillLanes);
    const sourceNotes = lane ? oneContinuousLine(lane.notes).filter((note) => note.startSeconds >= interval.start - 0.01 && note.startSeconds < interval.end - 0.01) : [];
    const source = lane ? (interval.kind === "primary" ? primarySource : provenance(lane, Boolean(options.gapFillLane))) : "Musical rest";
    const segmentId = `segment-${segmentIndex}-${Math.round(interval.start * 1000)}`;
    const unresolvedGap = sourceNotes.length === 0;
    const retainedRest = Boolean(options.retainedRestIds?.has(segmentId));
    sourceNotes.forEach((note) => notes.push(learningEvent(note, lane!, source, notes.length)));
    segments.push({ id: segmentId, startSeconds: interval.start, endSeconds: interval.end, sourceLaneId: unresolvedGap ? null : lane!.id, sourceLabel: unresolvedGap ? (retainedRest ? "Retained musical rest" : "Unresolved source gap") : lane!.label, provenance: unresolvedGap ? "Musical rest" : source, noteCount: sourceNotes.length, retainedRest });
  }
  const ordered = sorted(notes) as LearningMelodyEvent[];
  const timeline = { ...canonical, notes: ordered.map((note, cursorStep) => ({ ...note, cursorStep })) };
  return { timeline, notes: timeline.notes as LearningMelodyEvent[], segments, diagnostics: diagnostics(timeline.notes as LearningMelodyEvent[], canonical.durationSeconds, segments), primaryLaneId: primary.id };
}

export function replaceLearningSegmentSource(melody: LearningMelody, segmentId: string, lane: VoiceLane): LearningMelody {
  const segment = melody.segments.find((entry) => entry.id === segmentId);
  if (!segment) return melody;
  const kept = melody.notes.filter((note) => note.startSeconds < segment.startSeconds || note.startSeconds >= segment.endSeconds);
  const inserted = oneContinuousLine(lane.notes).filter((note) => note.startSeconds >= segment.startSeconds && note.startSeconds < segment.endSeconds).map((note, index) => learningEvent(note, lane, "Manual reference", kept.length + index));
  const notes = sorted([...kept, ...inserted]).map((note, cursorStep) => ({ ...note, cursorStep })) as LearningMelodyEvent[];
  const segments = melody.segments.map((entry) => entry.id === segmentId ? { ...entry, sourceLaneId: lane.id, sourceLabel: lane.label, provenance: "Manual reference" as const, noteCount: inserted.length, retainedRest: inserted.length === 0 } : entry);
  return { ...melody, notes, segments, timeline: { ...melody.timeline, notes }, diagnostics: diagnostics(notes, melody.timeline.durationSeconds, segments) };
}

export function retainLearningSegmentRest(melody: LearningMelody, segmentId: string): LearningMelody {
  const segment = melody.segments.find((entry) => entry.id === segmentId);
  if (!segment) return melody;
  const notes = melody.notes.filter((note) => note.startSeconds < segment.startSeconds || note.startSeconds >= segment.endSeconds).map((note, cursorStep) => ({ ...note, cursorStep }));
  const segments = melody.segments.map((entry) => entry.id === segmentId ? { ...entry, sourceLaneId: null, sourceLabel: "Retained musical rest", provenance: "Musical rest" as const, noteCount: 0, retainedRest: true } : entry);
  return { ...melody, notes, segments, timeline: { ...melody.timeline, notes }, diagnostics: diagnostics(notes, melody.timeline.durationSeconds, segments) };
}

export function compactLearningMelody(melody: LearningMelody, maxGapSeconds = 0.4, thresholdSeconds = 0.6): ActiveMelodyResult {
  return createActiveMelodyTimeline(melody.timeline, melody.notes, { restThresholdSeconds: thresholdSeconds, compressedGapSeconds: maxGapSeconds });
}

export function sameLearningSequence(a: Timeline, b: Timeline): boolean {
  return a.notes.length === b.notes.length && a.notes.every((note, index) => note.midi === b.notes[index].midi && note.startSeconds === b.notes[index].startSeconds && note.durationSeconds === b.notes[index].durationSeconds);
}
