import type { NoteEvent } from "./contracts";
import { guitarCandidates, type AuditionCallbacks, type GuitarConfig, type TimelineVisualizer } from "./instruments";

export class GuitarVisualizer implements TimelineVisualizer {
  constructor(private readonly root: HTMLElement, private config: GuitarConfig = { tuning: [40, 45, 50, 55, 59, 64], frets: 20 }, private readonly audition?: AuditionCallbacks) {}

  setLeftHanded(enabled: boolean): void {
    this.config = { ...this.config, leftHanded: enabled };
    this.root.classList.toggle("left-handed", enabled);
  }

  mount(): void {
    this.root.classList.add("learning-fretboard");
    this.root.classList.toggle("left-handed", Boolean(this.config.leftHanded));
    this.root.innerHTML = this.config.tuning.map((open, stringIndex) => {
      const string = this.config.tuning.length - stringIndex;
      return `<div class="guitar-string" data-string="${string}" aria-label="String ${string}">${Array.from({ length: this.config.frets + 1 }, (_, fret) => `<button type="button" data-fret="${fret}" data-midi="${open + fret}" aria-label="String ${string}, fret ${fret}">${fret}</button>`).join("")}</div>`;
    }).join("");
    this.root.querySelectorAll<HTMLButtonElement>("[data-midi]").forEach((fret) => {
      const start = (event: PointerEvent): void => { event.preventDefault(); fret.setPointerCapture?.(event.pointerId); this.audition?.noteOn(Number(fret.dataset.midi)); };
      const stop = (): void => this.audition?.noteOff();
      fret.addEventListener("pointerdown", start);
      fret.addEventListener("pointerup", stop);
      fret.addEventListener("pointercancel", stop);
      fret.addEventListener("lostpointercapture", stop);
    });
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    this.root.querySelectorAll(".active,.upcoming,.suggested,.source-authored").forEach((element) => element.classList.remove("active", "upcoming", "suggested", "source-authored"));
    const mark = (notes: NoteEvent[], state: "active" | "upcoming"): void => {
      for (const note of notes) {
        const candidate = guitarCandidates(note, this.config)[0];
        if (candidate) {
          const fret = this.root.querySelector(`[data-string="${candidate.string}"] [data-fret="${candidate.fret}"]`);
          fret?.classList.add(state, candidate.confidence === "explicit" ? "source-authored" : "suggested");
        }
      }
    };
    mark(upcoming, "upcoming");
    mark(active, "active");
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
