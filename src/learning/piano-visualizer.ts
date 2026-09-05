import type { NoteEvent } from "./contracts";
import type { NoteState, TimelineVisualizer } from "./instruments";

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
    if (this.follow && active[0]) this.root.querySelector<HTMLElement>(`[data-note="${active[0].midi}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}

export { PianoRangeVisualizer as Piano88Visualizer };
