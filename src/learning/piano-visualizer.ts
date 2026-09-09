import type { NoteEvent } from "./contracts";
import type { AuditionCallbacks, NoteState, TimelineVisualizer } from "./instruments";

const isBlack = (midi: number): boolean => [1, 3, 6, 8, 10].includes(midi % 12);

export class PianoRangeVisualizer implements TimelineVisualizer {
  private readonly min: number;
  private readonly max: number;

  constructor(private readonly root: HTMLElement, notes: NoteEvent[], private follow = false, private readonly audition?: AuditionCallbacks) {
    const pitches = notes.map((note) => note.midi);
    this.min = Math.max(21, Math.min(...pitches, 60) - 2);
    this.max = Math.min(108, Math.max(...pitches, 60) + 2);
  }

  setFollow(enabled: boolean): void { this.follow = enabled; }

  mount(): void {
    this.root.classList.add("learning-piano");
    this.root.innerHTML = Array.from({ length: this.max - this.min + 1 }, (_, index) => {
      const midi = this.min + index;
      return `<button type="button" class="learning-key ${isBlack(midi) ? "black" : "white"}" data-note="${midi}" aria-label="MIDI note ${midi}"></button>`;
    }).join("");
    this.root.querySelectorAll<HTMLButtonElement>("[data-note]").forEach((key) => {
      const start = (event: PointerEvent): void => { event.preventDefault(); key.classList.add("manual-audition"); key.setPointerCapture?.(event.pointerId); this.audition?.noteOn(Number(key.dataset.note)); };
      const stop = (): void => { key.classList.remove("manual-audition"); this.audition?.noteOff(); };
      key.addEventListener("pointerdown", start);
      key.addEventListener("pointerup", stop);
      key.addEventListener("pointercancel", stop);
      key.addEventListener("lostpointercapture", stop);
    });
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
    const activeKey = this.follow && active[0]
      ? this.root.querySelector<HTMLElement>(`[data-note="${active[0].midi}"]`)
      : null;
    if (activeKey) {
      const target = activeKey.offsetLeft + activeKey.offsetWidth / 2 - this.root.clientWidth / 2;
      this.root.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    }
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}

export { PianoRangeVisualizer as Piano88Visualizer };
