import type { Instrument } from "../types/song";
import type { Song } from "../types/song";
import { isVerifiedAccordionConfig } from "./instruments";

export type LearningSource = "musicxml" | "midi";

export interface LearningConfiguration {
  enabled: boolean;
  instruments: Instrument[];
  source: LearningSource;
  mapping: Record<string, unknown>;
  fingering: Record<string, unknown>;
}

function objectJson(value: string, label: string): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON.`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

export function parseLearningConfiguration(data: FormData): LearningConfiguration {
  const allowed: Instrument[] = ["piano", "guitar", "accordion"];
  const instruments = data.getAll("learning_instrument").map(String).filter((value): value is Instrument => allowed.includes(value as Instrument));
  const source = String(data.get("learning_source") || "musicxml") as LearningSource;
  if (!(["musicxml", "midi"] as const).includes(source)) throw new Error("Choose a valid learning source.");
  const enabled = data.get("learning_enabled") === "on";
  if (enabled && instruments.length === 0) throw new Error("Enable at least one learning instrument.");
  return {
    enabled,
    instruments,
    source,
    mapping: objectJson(String(data.get("learning_mapping") ?? ""), "Part mapping"),
    fingering: objectJson(String(data.get("learning_fingering") ?? ""), "Fingering overrides"),
  };
}

export function validateLearningPublication(song: Song): void {
  if (!song.learningEnabled) return;
  if (!(song.learningInstruments?.length)) throw new Error("Learning mode needs at least one instrument before publishing.");
  if (song.learningSource === "midi" && !song.midiUrl) throw new Error("The selected learning source requires a MIDI file.");
  if (song.learningSource !== "midi" && !song.musicXmlUrl) throw new Error("The selected learning source requires a MusicXML/MXL file.");
  if (song.learningInstruments.includes("accordion") && !isVerifiedAccordionConfig(song.learningMapping?.accordion)) throw new Error("Accordion publication requires a verified zura-accordion-mapping/v1 configuration.");
}
