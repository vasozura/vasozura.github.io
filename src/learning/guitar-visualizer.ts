import type { NoteEvent } from "./contracts";
import type { HarmonicEvent } from "./harmony";
import { chooseContinuousGuitarPosition, guitarFretLabels, guitarMidiAt, guitarStringLayout, type AuditionCallbacks, type GuitarConfig, type GuitarPosition, type TimelineVisualizer } from "./instruments";

const noteName = (midi: number): string => `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
const markerFrets = new Set([3, 5, 7, 9, 12, 15, 17, 19]);

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
    const header = `<div class="guitar-fret-header" aria-label="Fret numbers">${guitarFretLabels(this.config.frets).map((fret) => `<span class="${markerFrets.has(fret) ? fret === 12 ? "double-marker" : "fret-marker" : ""}">${fret}</span>`).join("")}</div>`;
    const strings = guitarStringLayout(this.config).map(({ openMidi, string }) => `<div class="guitar-string" data-string="${string}" aria-label="String ${string}"><b aria-hidden="true">${string}</b>${guitarFretLabels(this.config.frets).map((fret) => { const midi = guitarMidiAt(openMidi, fret); return `<button type="button" data-string="${string}" data-fret="${fret}" data-midi-note="${midi}" aria-label="String ${string}, fret ${fret}, ${noteName(midi)}"></button>`; }).join("")}</div>`).join("");
    this.root.innerHTML = `<div class="guitar-readout"><output class="guitar-note-status" aria-live="polite">—</output><output class="guitar-chord-status" aria-live="polite">ACTIVE CHORD: —</output></div><div class="guitar-neck">${header}${strings}</div>`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-midi-note]").forEach((fret) => {
      const start = (event: PointerEvent): void => { event.preventDefault(); fret.classList.add("manual-audition"); fret.dataset.noteLabel = noteName(Number(fret.dataset.midiNote)); fret.setPointerCapture?.(event.pointerId); this.audition?.noteOn(Number(fret.dataset.midiNote), "guitar"); };
      const stop = (): void => { fret.classList.remove("manual-audition"); delete fret.dataset.noteLabel; this.audition?.noteOff(); };
      fret.addEventListener("pointerdown", start);
      fret.addEventListener("pointerup", stop);
      fret.addEventListener("pointercancel", stop);
      fret.addEventListener("pointerleave", stop);
      fret.addEventListener("lostpointercapture", stop);
    });
  }

  setActiveChord(harmony: HarmonicEvent | null): void {
    this.root.querySelectorAll<HTMLElement>(".chord-active").forEach((cell) => cell.classList.remove("chord-active"));
    const status = this.root.querySelector<HTMLOutputElement>(".guitar-chord-status");
    if (!harmony) {
      if (status) status.value = "ACTIVE CHORD: —";
      return;
    }
    for (const position of harmony.guitar) this.root.querySelector<HTMLElement>(`button[data-string="${position.string}"][data-fret="${position.fret}"]`)?.classList.add("chord-active");
    if (status) status.value = `ACTIVE CHORD: ${harmony.label} · ${harmony.guitar.map((position) => `S${position.string}/F${position.fret}`).join(" · ")}`;
  }

  clear(): void {
    this.previous = null;
    this.render([], []);
    this.setActiveChord(null);
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    this.root.querySelectorAll<HTMLElement>(".active,.upcoming,.suggested,.source-authored").forEach((element) => { element.classList.remove("active", "upcoming", "suggested", "source-authored"); delete element.dataset.noteLabel; });
    let position = this.previous;
    const activeLabels: string[] = [];
    const mark = (notes: NoteEvent[], state: "active" | "upcoming"): void => {
      for (const note of notes) {
        const candidate = chooseContinuousGuitarPosition(note, position, this.config);
        if (candidate) {
          position = { string: candidate.string!, fret: candidate.fret! };
          const fret = this.root.querySelector(`[data-string="${candidate.string}"] [data-fret="${candidate.fret}"]`);
          fret?.classList.add(state, candidate.confidence === "explicit" ? "source-authored" : "suggested");
          if (fret instanceof HTMLElement) fret.dataset.noteLabel = noteName(note.midi);
          if (state === "active") activeLabels.push(`${noteName(note.midi)} · S${candidate.string}/F${candidate.fret}`);
        }
      }
    };
    mark(active, "active");
    if (active.length && position) this.previous = position;
    mark(upcoming, "upcoming");
    const status = this.root.querySelector<HTMLOutputElement>(".guitar-note-status");
    if (status) status.value = activeLabels.join(" · ") || "—";
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
