import type { Instrument } from "../types/song";

export interface InstrumentVisualizer {
  readonly instrument: Instrument;
  mount(): void;
  setActiveNotes(midiNotes: number[]): void;
  clear(): void;
}

export interface FingeringEvent {
  midiTimeSeconds: number;
  midiNote: number;
  fingering: string | null;
}

export class PianoVisualizer implements InstrumentVisualizer {
  readonly instrument = "piano" as const;
  constructor(private readonly root: HTMLElement, private readonly lowestMidi = 36, private readonly highestMidi = 84) {}

  mount(): void {
    this.root.innerHTML = Array.from({ length: this.highestMidi - this.lowestMidi + 1 }, (_, index) => {
      const midi = index + this.lowestMidi;
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      return `<span class="piano-key ${black ? "black" : "white"}" data-midi-note="${midi}" aria-hidden="true"></span>`;
    }).join("");
  }

  setActiveNotes(midiNotes: number[]): void {
    const active = new Set(midiNotes);
    this.root.querySelectorAll<HTMLElement>("[data-midi-note]").forEach((key) => key.classList.toggle("active", active.has(Number(key.dataset.midiNote))));
  }

  clear(): void { this.setActiveNotes([]); }
}

export interface FrettedOrButtonVisualizer extends InstrumentVisualizer {
  setFingeringMap(events: FingeringEvent[]): void;
}

// Guitar and accordion implementations must consume explicit fingering mappings.
// They intentionally do not infer fingering from an MP3 waveform.
