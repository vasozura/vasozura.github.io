import type { NoteEvent, Timeline } from "./contracts";

export type PlaybackMode = "chords" | "solo";
export type StaffScope = "both" | "treble" | "bass";

export interface PlaybackSelection { mode: PlaybackMode; voices: number; scope: StaffScope; }
export interface LanePlaybackSelection extends PlaybackSelection { selectedLaneIds?: ReadonlySet<string>; }

function explicitScope(note: NoteEvent): "treble" | "bass" | null {
  if (note.staff != null) return note.staff === 1 ? "treble" : "bass";
  if (note.hand === "right") return "treble";
  if (note.hand === "left") return "bass";
  return null;
}

export function noteMatchesStaffScope(note: NoteEvent, scope: StaffScope): boolean {
  if (scope === "both") return true;
  return explicitScope(note) === scope || (explicitScope(note) === null && (scope === "treble" ? note.midi >= 60 : note.midi < 60));
}

export function selectPlaybackNotes(notes: NoteEvent[], selection: PlaybackSelection): NoteEvent[] {
  const scoped = notes.filter((note) => noteMatchesStaffScope(note, selection.scope));
  // Chords mode uses the derived harmonic timeline, never raw score polyphony.
  if (selection.mode === "chords") return [];
  const voices = Math.max(1, Math.floor(selection.voices));
  if (selection.scope === "treble") return [...scoped].sort((a, b) => b.midi - a.midi || a.startSeconds - b.startSeconds || a.id.localeCompare(b.id)).slice(0, voices);
  if (selection.scope === "bass") return [...scoped].sort((a, b) => a.midi - b.midi || a.startSeconds - b.startSeconds || a.id.localeCompare(b.id)).slice(0, voices);
  return scoped.slice(0, voices);
}

export function practicalVoiceCap(timeline: Timeline, cap = 8): number {
  const points = timeline.notes.flatMap((note) => [[note.startSeconds, 1] as const, [note.startSeconds + note.durationSeconds, -1] as const]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let maximum = 1;
  for (const [, change] of points) { active += change; maximum = Math.max(maximum, active); }
  return Math.max(1, Math.min(cap, maximum));
}

export function hasExplicitStaffIdentity(timeline: Timeline): boolean {
  return timeline.notes.some((note) => note.staff != null || note.hand !== "unknown");
}
