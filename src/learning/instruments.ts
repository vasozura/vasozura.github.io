import type { FingeringCandidate, NoteEvent } from "./contracts";

export type NoteState = "active" | "upcoming" | "correct" | "missed" | "wrong";
export interface TimelineVisualizer {
  mount(): void;
  render(active: NoteEvent[], upcoming: NoteEvent[], states?: Map<number, NoteState>): void;
  destroy(): void;
}

const isBlack = (midi: number): boolean => [1, 3, 6, 8, 10].includes(midi % 12);

export class PianoRangeVisualizer implements TimelineVisualizer {
  private readonly min: number;
  private readonly max: number;

  constructor(private readonly root: HTMLElement, notes: NoteEvent[], private follow = true) {
    const pitches = notes.map((note) => note.midi);
    this.min = Math.max(21, Math.min(...pitches, 60) - 2);
    this.max = Math.min(108, Math.max(...pitches, 60) + 2);
  }

  setFollow(enabled: boolean): void { this.follow = enabled; }

  mount(): void {
    this.root.classList.add("learning-piano");
    this.root.innerHTML = Array.from({ length: this.max - this.min + 1 }, (_, index) => {
      const midi = this.min + index;
      return `<span class="learning-key ${isBlack(midi) ? "black" : "white"}" data-note="${midi}" role="img" aria-label="MIDI note ${midi}"></span>`;
    }).join("");
  }

  render(active: NoteEvent[], upcoming: NoteEvent[], states = new Map<number, NoteState>()): void {
    const activeByMidi = new Map(active.map((note) => [note.midi, note]));
    const upcomingPitches = new Set(upcoming.map((note) => note.midi));
    this.root.querySelectorAll<HTMLElement>("[data-note]").forEach((key) => {
      const midi = Number(key.dataset.note);
      const note = activeByMidi.get(midi);
      const hand = note?.hand === "left" || note?.hand === "right" ? `hand-${note.hand}` : "";
      key.className = `learning-key ${isBlack(midi) ? "black" : "white"} ${note ? "active" : ""} ${upcomingPitches.has(midi) ? "upcoming" : ""} ${hand} ${states.get(midi) ?? ""}`;
    });
    if (this.follow && active[0]) {
      this.root.querySelector<HTMLElement>(`[data-note="${active[0].midi}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}

export { PianoRangeVisualizer as Piano88Visualizer };

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

export class GuitarVisualizer implements TimelineVisualizer {
  constructor(private readonly root: HTMLElement, private config: GuitarConfig = { tuning: [40, 45, 50, 55, 59, 64], frets: 20 }) {}

  setLeftHanded(enabled: boolean): void {
    this.config = { ...this.config, leftHanded: enabled };
    this.root.classList.toggle("left-handed", enabled);
  }

  mount(): void {
    this.root.classList.add("learning-fretboard");
    this.root.classList.toggle("left-handed", Boolean(this.config.leftHanded));
    this.root.innerHTML = this.config.tuning.map((_, stringIndex) => `<div class="guitar-string" data-string="${stringIndex + 1}" aria-label="String ${stringIndex + 1}">${Array.from({ length: this.config.frets + 1 }, (_, fret) => `<span data-fret="${fret}">${fret}</span>`).join("")}</div>`).join("");
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    this.root.querySelectorAll(".active,.upcoming").forEach((element) => element.classList.remove("active", "upcoming"));
    const mark = (notes: NoteEvent[], state: "active" | "upcoming"): void => {
      for (const note of notes) {
        const explicit = guitarCandidates(note, this.config).find((candidate) => candidate.confidence === "explicit");
        if (!explicit) continue;
        this.root.querySelector(`[data-string="${explicit.string}"] [data-fret="${explicit.fret}"]`)?.classList.add(state);
      }
    };
    mark(upcoming, "upcoming");
    mark(active, "active");
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}

export type AccordionSystem = "stradella" | "free-bass";
export interface AccordionConfig {
  system: AccordionSystem;
  rightHandMidi: number[];
  bassButtons: Array<{ id: string; midi: number }>;
  verified: true;
}

export function isVerifiedAccordionConfig(value: unknown): value is AccordionConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<AccordionConfig>;
  return config.verified === true && (config.system === "stradella" || config.system === "free-bass") && Array.isArray(config.rightHandMidi) && config.rightHandMidi.every(Number.isInteger) && Array.isArray(config.bassButtons) && config.bassButtons.every((button) => typeof button?.id === "string" && Number.isInteger(button.midi));
}

export class AccordionVisualizer implements TimelineVisualizer {
  constructor(private readonly root: HTMLElement, private readonly config: AccordionConfig | null) {}

  mount(): void {
    this.root.classList.add("learning-accordion");
    if (!this.config) {
      this.root.innerHTML = '<p class="learning-placeholder">Accordion visualization requires a verified part and button mapping.</p>';
      return;
    }
    this.root.innerHTML = `<p>${this.config.system} · verified mapping</p><div>${this.config.rightHandMidi.map((midi) => `<span data-note="${midi}">${midi}</span>`).join("")}</div><div>${this.config.bassButtons.map((button) => `<span data-note="${button.midi}">${button.id}</span>`).join("")}</div>`;
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    const activePitches = new Set(active.map((note) => note.midi));
    const upcomingPitches = new Set(upcoming.map((note) => note.midi));
    this.root.querySelectorAll<HTMLElement>("[data-note]").forEach((element) => {
      const midi = Number(element.dataset.note);
      element.classList.toggle("active", activePitches.has(midi));
      element.classList.toggle("upcoming", upcomingPitches.has(midi));
    });
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
