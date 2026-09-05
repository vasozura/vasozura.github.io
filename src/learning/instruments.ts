import type { FingeringCandidate, NoteEvent } from "./contracts";

export type NoteState = "active" | "upcoming" | "correct" | "missed" | "wrong";
export interface TimelineVisualizer {
  mount(): void;
  render(active: NoteEvent[], upcoming: NoteEvent[], states?: Map<number, NoteState>): void;
  destroy(): void;
}

export interface GuitarConfig { tuning: number[]; frets: number; leftHanded?: boolean; }

export function guitarCandidates(note: NoteEvent, config: GuitarConfig = { tuning: [40, 45, 50, 55, 59, 64], frets: 20 }): FingeringCandidate[] {
  if (note.string && note.fret !== undefined) {
    return [{ instrument: "guitar", noteId: note.id, rank: 1, confidence: "explicit", string: note.string, fret: note.fret, reason: "Source-authored score position" }];
  }
  return config.tuning.map((open, index) => ({ string: index + 1, fret: note.midi - open }))
    .filter((candidate) => candidate.fret >= 0 && candidate.fret <= config.frets)
    .sort((a, b) => a.fret - b.fret)
    .map((candidate, index) => ({ instrument: "guitar", noteId: note.id, rank: index + 1, confidence: "suggestion", ...candidate, reason: "Playable candidate; not authoritative" }));
}

export type AccordionSystem = "piano_accordion" | "chromatic_button" | "stradella" | "free_bass" | "custom";
export type AccordionProvenance = "source" | "deterministic" | "inferred";
export interface AccordionButtonMapping {
  id: string;
  side: "right" | "left";
  row: number;
  column: number;
  midi: number[];
  label?: string;
  kind?: "note" | "bass" | "counterbass" | "major" | "minor" | "seventh" | "diminished";
  bellows?: "push" | "pull" | "either";
  finger?: number;
  provenance: AccordionProvenance;
  confidence: number;
}
export interface AccordionConfig {
  schema_version: "zura-accordion-mapping/v1";
  layout_id: string;
  system: AccordionSystem;
  orientation: "vertical" | "horizontal";
  row_direction: "top_to_bottom" | "bottom_to_top" | "left_to_right" | "right_to_left";
  row_count: number;
  buttons: AccordionButtonMapping[];
  verified: true;
}

interface LegacyAccordionConfig {
  system: "stradella" | "free-bass";
  rightHandMidi: number[];
  bassButtons: Array<{ id: string; midi: number }>;
  verified: true;
}

const validMidi = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 127;

function validAccordionButton(value: unknown): value is AccordionButtonMapping {
  if (!value || typeof value !== "object") return false;
  const button = value as Partial<AccordionButtonMapping>;
  return typeof button.id === "string" && button.id.length > 0
    && (button.side === "right" || button.side === "left")
    && Number.isInteger(button.row) && Number(button.row) > 0
    && Number.isInteger(button.column) && Number(button.column) > 0
    && Array.isArray(button.midi) && button.midi.length > 0 && button.midi.every(validMidi)
    && ["source", "deterministic", "inferred"].includes(String(button.provenance))
    && typeof button.confidence === "number" && button.confidence >= 0 && button.confidence <= 1
    && !(button.provenance === "source" && button.confidence !== 1)
    && !(button.provenance === "inferred" && (button.bellows !== undefined || button.finger !== undefined));
}

export function isVerifiedAccordionConfig(value: unknown): value is AccordionConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<AccordionConfig> & Partial<LegacyAccordionConfig>;
  if (config.verified !== true) return false;
  if (config.schema_version === "zura-accordion-mapping/v1") {
    if (!config.layout_id || !["piano_accordion", "chromatic_button", "stradella", "free_bass", "custom"].includes(String(config.system))) return false;
    if (!Number.isInteger(config.row_count) || Number(config.row_count) < 1 || !Array.isArray(config.buttons) || !config.buttons.every(validAccordionButton)) return false;
    const ids = config.buttons.map((button) => button.id);
    return ids.length === new Set(ids).size && config.buttons.every((button) => button.row <= Number(config.row_count));
  }
  return (config.system === "stradella" || config.system === "free-bass")
    && Array.isArray(config.rightHandMidi) && config.rightHandMidi.every(validMidi)
    && Array.isArray(config.bassButtons) && config.bassButtons.every((button) => typeof button?.id === "string" && validMidi(button.midi));
}

export function normalizedAccordionButtons(config: AccordionConfig | LegacyAccordionConfig): AccordionButtonMapping[] {
  if ("schema_version" in config) return config.buttons;
  return [
    ...config.rightHandMidi.map((midi, index) => ({ id: `rh-${midi}`, side: "right" as const, row: 1, column: index + 1, midi: [midi], label: String(midi), kind: "note" as const, provenance: "source" as const, confidence: 1 })),
    ...config.bassButtons.map((button, index) => ({ id: button.id, side: "left" as const, row: 1, column: index + 1, midi: [button.midi], label: button.id, kind: "bass" as const, provenance: "source" as const, confidence: 1 })),
  ];
}
