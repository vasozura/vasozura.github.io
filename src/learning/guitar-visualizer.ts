import type { NoteEvent } from "./contracts";
import { guitarCandidates, type GuitarConfig, type TimelineVisualizer } from "./instruments";

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
        if (explicit) this.root.querySelector(`[data-string="${explicit.string}"] [data-fret="${explicit.fret}"]`)?.classList.add(state);
      }
    };
    mark(upcoming, "upcoming");
    mark(active, "active");
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
