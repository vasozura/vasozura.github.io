import type { NoteEvent, ScoreManifest } from "./contracts";

export type LaneScope = "both" | "treble" | "bass";

export interface VoiceLane {
  id: string;
  label: string;
  partId: string;
  partName: string;
  staff: number | null;
  voice: string | null;
  inferred: boolean;
  notes: NoteEvent[];
}

export type ActiveTrackId = "melody" | "piano" | "guitar";
export interface ActiveTrackOption { id: ActiveTrackId; label: string; lane: VoiceLane; }
export interface ActiveTrackResolution { option: ActiveTrackOption | null; usedFallback: boolean; }

const laneKey = (partId: string, staff: number | null, voice: string | null): string =>
  `${partId}::s${staff ?? "?"}::v${voice ?? "?"}`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 60;
}

function laneLabel(partName: string, staff: number | null, voice: string | null, inferred: boolean, index = 0): string {
  const details = [staff == null ? null : `Staff ${staff}`, voice == null ? null : `Voice ${voice}`].filter(Boolean).join(" · ");
  const base = details ? `${partName} · ${details}` : `${partName}${index ? ` · Lane ${index + 1}` : ""}`;
  return inferred ? `${base} · inferred` : base;
}

function inferMissingLanes(notes: NoteEvent[], partId: string, partName: string, staff: number | null): VoiceLane[] {
  const assigned: Array<{ notes: NoteEvent[]; end: number; pitch: number }> = [];
  for (const note of [...notes].sort((a, b) => a.startSeconds - b.startSeconds || b.midi - a.midi || a.id.localeCompare(b.id))) {
    const candidates = assigned
      .map((lane, index) => ({ lane, index, gap: note.startSeconds - lane.end, distance: Math.abs(note.midi - lane.pitch) }))
      .filter(({ gap }) => gap >= -0.015)
      .sort((a, b) => a.distance - b.distance || a.gap - b.gap || a.index - b.index);
    const target = candidates[0]?.lane;
    if (target) {
      target.notes.push(note);
      target.end = Math.max(target.end, note.startSeconds + note.durationSeconds);
      target.pitch = note.midi;
    } else {
      assigned.push({ notes: [note], end: note.startSeconds + note.durationSeconds, pitch: note.midi });
    }
  }
  return assigned.map((lane, index) => ({
    id: `${laneKey(partId, staff, null)}::i${index}`,
    label: laneLabel(partName, staff, null, true, index),
    partId,
    partName,
    staff,
    voice: null,
    inferred: true,
    notes: lane.notes,
  }));
}

export function buildVoiceLanes(manifest: ScoreManifest): VoiceLane[] {
  const parts = new Map(manifest.parts.map((part) => [part.id, part]));
  const explicit = new Map<string, NoteEvent[]>();
  const missing = new Map<string, NoteEvent[]>();
  for (const note of manifest.timeline.notes) {
    const staff = note.staff ?? null;
    const key = note.voice == null || note.voice === "" ? `${note.partId}::${staff ?? "?"}` : laneKey(note.partId, staff, note.voice);
    const target = note.voice == null || note.voice === "" ? missing : explicit;
    const list = target.get(key) ?? [];
    list.push(note);
    target.set(key, list);
  }
  const lanes: VoiceLane[] = [];
  for (const [key, notes] of explicit) {
    const first = notes[0];
    const part = parts.get(first.partId);
    lanes.push({ id: key, label: laneLabel(part?.name ?? first.partId, first.staff ?? null, first.voice ?? null, false), partId: first.partId, partName: part?.name ?? first.partId, staff: first.staff ?? null, voice: first.voice ?? null, inferred: false, notes });
  }
  for (const notes of missing.values()) {
    const first = notes[0];
    lanes.push(...inferMissingLanes(notes, first.partId, parts.get(first.partId)?.name ?? first.partId, first.staff ?? null));
  }
  return lanes.sort((a, b) => a.partName.localeCompare(b.partName) || (a.staff ?? 0) - (b.staff ?? 0) || a.id.localeCompare(b.id));
}

function laneScore(lane: VoiceLane): number {
  const sorted = [...lane.notes].sort((a, b) => a.startSeconds - b.startSeconds);
  const overlaps = sorted.slice(1).filter((note, index) => note.startSeconds < sorted[index].startSeconds + sorted[index].durationSeconds - 0.015).length;
  const steps = sorted.slice(1).map((note, index) => Math.abs(note.midi - sorted[index].midi));
  const continuity = steps.length ? steps.filter((step) => step <= 7).length / steps.length : 1;
  return median(sorted.map((note) => note.midi)) + continuity * 18 - overlaps * 12 + Math.log2(sorted.length + 1) * 3;
}

export function selectMelodyLane(manifest: ScoreManifest, lanes = buildVoiceLanes(manifest)): VoiceLane | null {
  if (!lanes.length) return null;
  const named = lanes.filter((lane) => /(^|\b)(lead\s+vocals?|vocals?|voice|singer|melody)(\b|$)/i.test(`${lane.partName} ${manifest.parts.find((part) => part.id === lane.partId)?.instrument ?? ""}`));
  const winner = [...(named.length ? named : lanes)].sort((a, b) => laneScore(b) - laneScore(a) || a.id.localeCompare(b.id))[0];
  if (!winner) return null;
  const sourceNamed = named.includes(winner);
  return sourceNamed ? { ...winner, label: winner.partName, inferred: false } : { ...winner, label: "Melody · inferred", inferred: true };
}

function namedInstrumentLane(manifest: ScoreManifest, lanes: readonly VoiceLane[], pattern: RegExp): VoiceLane | null {
  const matches = lanes.filter((lane) => {
    const part = manifest.parts.find((entry) => entry.id === lane.partId);
    return pattern.test(`${lane.partName} ${part?.instrument ?? ""}`);
  });
  return [...matches].sort((left, right) => right.notes.length - left.notes.length || left.id.localeCompare(right.id))[0] ?? null;
}

export function buildActiveTrackOptions(manifest: ScoreManifest, lanes = buildVoiceLanes(manifest), melodyLane = selectMelodyLane(manifest, lanes)): ActiveTrackOption[] {
  const options: ActiveTrackOption[] = [];
  if (melodyLane) options.push({ id: "melody", label: /vocal|voice|singer/iu.test(melodyLane.partName) ? "VOCAL / MELODY" : "MELODY", lane: melodyLane });
  const piano = namedInstrumentLane(manifest, lanes, /\b(piano|pno|keyboard)\b/iu);
  const guitar = namedInstrumentLane(manifest, lanes, /\b(guitar|gtr)\b/iu);
  if (piano && piano.id !== melodyLane?.id) options.push({ id: "piano", label: "PIANO", lane: piano });
  if (guitar && guitar.id !== melodyLane?.id) options.push({ id: "guitar", label: "GUITAR", lane: guitar });
  return options;
}

export function resolveActiveTrack(requested: ActiveTrackId | null | undefined, options: readonly ActiveTrackOption[]): ActiveTrackResolution {
  const requestedOption = options.find((option) => option.id === requested);
  if (requestedOption) return { option: requestedOption, usedFallback: false };
  const fallback = (["melody", "piano", "guitar"] as const).map((id) => options.find((option) => option.id === id)).find(Boolean) ?? options[0] ?? null;
  return { option: fallback, usedFallback: requested != null && fallback?.id !== requested };
}

export function laneInScope(lane: VoiceLane, scope: LaneScope): boolean {
  if (scope === "both") return true;
  if (lane.staff != null) return scope === "treble" ? lane.staff === 1 : lane.staff > 1;
  const pitch = median(lane.notes.map((note) => note.midi));
  return scope === "treble" ? pitch >= 60 : pitch < 60;
}

export function selectLaneNotes(active: NoteEvent[], lanes: VoiceLane[], selectedLaneIds: ReadonlySet<string>): NoteEvent[] {
  const selectedNotes = new Set(lanes.filter((lane) => selectedLaneIds.has(lane.id)).flatMap((lane) => lane.notes.map((note) => note.id)));
  return active.filter((note) => selectedNotes.has(note.id));
}
