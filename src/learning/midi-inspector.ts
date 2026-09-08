import type { NoteEvent, Timeline } from "./contracts";
import { createActiveMelodyTimeline, type ActiveMelodyResult } from "./active-melody";

export interface MidiTrackLike {
  name?: string;
  channel?: number;
  instrument?: { name?: string; family?: string; number?: number };
  notes: Array<{ time: number; duration: number; midi: number; velocity?: number }>;
}
export interface MidiLike { duration: number; header: { tempos?: Array<{ bpm: number; ticks?: number }> }; tracks: MidiTrackLike[]; }
export type TrackRank = "Likely Vocal" | "Likely Melody" | "Accompaniment" | "Bass" | "Unknown";
export interface InspectedMidiTrack {
  sourceId: string;
  sourceName: string;
  trackIndex: number;
  name: string;
  instrument: string;
  channel: number | null;
  notes: NoteEvent[];
  durationSeconds: number;
  pitchMin: number | null;
  pitchMax: number | null;
  polyphonyRatio: number;
  texture: "monophonic" | "mostly monophonic" | "polyphonic";
  averageGapSeconds: number;
  rank: TrackRank;
  explicitVocal: boolean;
}
export interface InspectedMidiSource { id: string; name: string; durationSeconds: number; bpm: number; tracks: InspectedMidiTrack[]; }
export interface TrackComparison { durationDifferenceSeconds: number; tempoDifferenceBpm: number; noteDensityDifference: number; contourSimilarity: number; aligned: boolean; }
export interface MelodyContourPoint { noteId: string; midi: number; startSeconds: number; durationSeconds: number; }

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const overlapRatio = (notes: NoteEvent[]): number => {
  if (notes.length < 2) return 0;
  const sorted = [...notes].sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi);
  return sorted.slice(1).filter((note, index) => note.startSeconds < sorted[index].startSeconds + sorted[index].durationSeconds - 0.01).length / (sorted.length - 1);
};

const averageGap = (notes: NoteEvent[]): number => {
  if (notes.length < 2) return 0;
  const sorted = [...notes].sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi);
  const gaps = sorted.slice(1).map((note, index) => Math.max(0, note.startSeconds - (sorted[index].startSeconds + sorted[index].durationSeconds)));
  return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
};

function classify(name: string, instrument: string, notes: NoteEvent[], polyphony: number): { rank: TrackRank; explicitVocal: boolean } {
  const descriptor = `${name} ${instrument}`;
  const explicitVocal = /(^|\b)(lead\s+vocals?|vocals?|voice|singer)(\b|$)/i.test(descriptor);
  if (explicitVocal) return { rank: "Likely Vocal", explicitVocal };
  if (/\bbass\b/i.test(descriptor) || median(notes.map((note) => note.midi)) < 48) return { rank: "Bass", explicitVocal };
  if (/\b(melody|lead|solo)\b/i.test(descriptor) || (notes.length >= 8 && polyphony < 0.08)) return { rank: "Likely Melody", explicitVocal };
  if (notes.length && polyphony > 0.2) return { rank: "Accompaniment", explicitVocal };
  return { rank: "Unknown", explicitVocal };
}

export function inspectMidiSource(name: string, midi: MidiLike, id = name): InspectedMidiSource {
  const bpm = midi.header.tempos?.[0]?.bpm ?? 120;
  const sourceId = id;
  const tracks = midi.tracks.map((track, trackIndex): InspectedMidiTrack => {
    const notes: NoteEvent[] = track.notes
      .map((note, noteIndex): NoteEvent => ({ id: `${sourceId}:t${trackIndex}:n${noteIndex}`, partId: `${sourceId}:t${trackIndex}`, measureIndex: 0, beat: 1, startSeconds: note.time, durationSeconds: note.duration, midi: note.midi, velocity: note.velocity ?? 0.8, hand: "unknown" }))
      .sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi);
    const polyphonyRatio = overlapRatio(notes);
    const nameValue = track.name?.trim() || "Unnamed track";
    const instrument = track.instrument?.name?.trim() || track.instrument?.family?.trim() || "Unknown instrument";
    const classification = classify(nameValue, instrument, notes, polyphonyRatio);
    return {
      sourceId, sourceName: name, trackIndex, name: nameValue, instrument,
      channel: Number.isInteger(track.channel) ? track.channel! + 1 : null,
      notes,
      durationSeconds: notes.reduce((end, note) => Math.max(end, note.startSeconds + note.durationSeconds), 0),
      pitchMin: notes.length ? Math.min(...notes.map((note) => note.midi)) : null,
      pitchMax: notes.length ? Math.max(...notes.map((note) => note.midi)) : null,
      polyphonyRatio,
      texture: polyphonyRatio > 0.2 ? "polyphonic" : polyphonyRatio > 0.05 ? "mostly monophonic" : "monophonic",
      averageGapSeconds: averageGap(notes),
      ...classification,
    };
  });
  return { id: sourceId, name, durationSeconds: midi.duration, bpm, tracks };
}

export async function parseMidiFiles(files: Iterable<File>, decode?: (buffer: ArrayBuffer) => MidiLike): Promise<InspectedMidiSource[]> {
  let parser = decode;
  if (!parser) {
    const { Midi } = await import("@tonejs/midi");
    parser = (buffer) => new Midi(buffer) as unknown as MidiLike;
  }
  const result: InspectedMidiSource[] = [];
  for (const [index, file] of [...files].entries()) result.push(inspectMidiSource(file.name, parser(await file.arrayBuffer()), `local-${index}-${file.name}`));
  return result;
}

export function timelineForTrack(track: InspectedMidiTrack, bpm = 120): Timeline {
  const durationSeconds = track.durationSeconds;
  return { version: "v1", durationSeconds, notes: track.notes.map((note) => ({ ...note })), tempos: [{ atSeconds: 0, bpm, measureIndex: 0 }], timeSignatures: [{ atSeconds: 0, beats: 4, beatType: 4, measureIndex: 0 }], measures: [{ index: 0, number: "1", startSeconds: 0, durationSeconds, beats: 4, beatType: 4, pickup: false }] };
}

export function activeTimelineForTrack(track: InspectedMidiTrack, bpm = 120, threshold = 0.6, gap = 0.2): ActiveMelodyResult {
  const source = timelineForTrack(track, bpm);
  return createActiveMelodyTimeline(source, source.notes, { restThresholdSeconds: threshold, compressedGapSeconds: gap });
}

export function chooseSessionMelody(manual: InspectedMidiTrack | null, suggestions: InspectedMidiTrack[]): InspectedMidiTrack | null {
  return manual ?? suggestions.find((track) => track.rank === "Likely Vocal") ?? suggestions.find((track) => track.rank === "Likely Melody") ?? null;
}

export function melodyContourPoints(track: InspectedMidiTrack): MelodyContourPoint[] {
  return track.notes.map((note) => ({ noteId: note.id, midi: note.midi, startSeconds: note.startSeconds, durationSeconds: note.durationSeconds }));
}

function contour(notes: NoteEvent[]): number[] {
  return notes.slice(0, 128).map((note) => note.midi);
}

export function compareTrack(track: InspectedMidiTrack, canonical: Timeline, sourceBpm: number): TrackComparison {
  const canonicalBpm = canonical.tempos[0]?.bpm ?? 120;
  const canonicalContour = contour(canonical.notes);
  const trackContour = contour(track.notes);
  const pairs = Math.min(canonicalContour.length, trackContour.length);
  const contourSimilarity = pairs ? trackContour.slice(0, pairs).filter((pitch, index) => Math.abs(pitch - canonicalContour[index]) <= 2).length / pairs : 0;
  const durationDifferenceSeconds = track.durationSeconds - canonical.durationSeconds;
  const noteDensityDifference = track.notes.length / Math.max(1, track.durationSeconds) - canonical.notes.length / Math.max(1, canonical.durationSeconds);
  const tempoDifferenceBpm = sourceBpm - canonicalBpm;
  return { durationDifferenceSeconds, tempoDifferenceBpm, noteDensityDifference, contourSimilarity, aligned: Math.abs(durationDifferenceSeconds) <= Math.max(2, canonical.durationSeconds * 0.05) && Math.abs(tempoDifferenceBpm) <= 3 };
}
