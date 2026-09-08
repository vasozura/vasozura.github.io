import type { NoteEvent } from "./contracts";
import { chooseContinuousGuitarPosition, guitarFretLabels, guitarStringLayout, type AuditionCallbacks, type GuitarConfig, type GuitarPosition, type TimelineVisualizer } from "./instruments";

export class GuitarVisualizer implements TimelineVisualizer {
  private previous: GuitarPosition | null = null;
  constructor(private readonly root: HTMLElement, private config: GuitarConfig = { tuning: [40, 45, 50, 55, 59, 64], frets: 20 }, private readonly audition?: AuditionCallbacks) {}

  setLeftHanded(enabled: boolean): void {
    this.config = { ...this.config, leftHanded: enabled };
    this.root.classList.toggle("left-handed", enabled);
  }

  mount(): void {
    this.root.classList.add("learning-fretboard");
    this.root.classList.toggle("left-handed", Boolean(this.config.leftHanded));
    const header = `<div class="guitar-fret-header" aria-label="Fret numbers">${guitarFretLabels(this.config.frets).map((fret) => `<span>${fret}</span>`).join("")}</div>`;
    this.root.innerHTML = header + guitarStringLayout(this.config).map(({ openMidi, string }) => `<div class="guitar-string" data-string="${string}" aria-label="String ${string}">${guitarFretLabels(this.config.frets).map((fret) => `<button type="button" data-fret="${fret}" data-midi="${openMidi + fret}" aria-label="String ${string}, fret ${fret}"><span class="visually-hidden">String ${string}, fret ${fret}</span></button>`).join("")}</div>`).join("");
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
    let position = this.previous;
    const mark = (notes: NoteEvent[], state: "active" | "upcoming"): void => {
      for (const note of notes) {
        const candidate = chooseContinuousGuitarPosition(note, position, this.config);
        if (candidate) {
          position = { string: candidate.string!, fret: candidate.fret! };
          const fret = this.root.querySelector(`[data-string="${candidate.string}"] [data-fret="${candidate.fret}"]`);
          fret?.classList.add(state, candidate.confidence === "explicit" ? "source-authored" : "suggested");
        }
      }
    };
    mark(active, "active");
    if (active.length && position) this.previous = position;
    mark(upcoming, "upcoming");
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
