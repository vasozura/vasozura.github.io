import type { NoteEvent } from "./contracts";
import type { CanonicalScheduler, SchedulerFrame } from "./scheduler";
import { SampleInstrumentEngine, type InstrumentName, type InstrumentPlayback } from "../audio/sample-instrument";

export class SchedulerAudioAdapter {
  private played = new Set<string>();
  private lastBeat = -1;
  private lastPosition = 0;
  private metronome = false;
  private readonly frame = (event: Event): void => this.render((event as CustomEvent<SchedulerFrame>).detail);

  constructor(
    private scheduler: CanonicalScheduler,
    private readonly instrument: InstrumentPlayback = new SampleInstrumentEngine(),
  ) { scheduler.addEventListener("frame", this.frame); }

  async enable(): Promise<void> {
    await this.instrument.enable(this.scheduler.timeline.notes.map((note) => note.midi));
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  setInstrument(instrument: InstrumentName): void { this.instrument.setInstrument(instrument); }
  reset(): void { this.played.clear(); this.lastBeat = -1; this.lastPosition = 0; this.instrument.releaseAll(); }

  destroy(): void {
    this.scheduler.removeEventListener("frame", this.frame);
    this.instrument.destroy();
  }

  private render(frame: SchedulerFrame): void {
    if (frame.position + 0.01 < this.lastPosition) {
      this.played.clear();
      this.instrument.releaseAll();
    }
    frame.active.forEach((note) => { if (!this.played.has(note.id)) { this.played.add(note.id); this.sound(note, frame.tempoPercent); } });
    const beatLength = 60 / (this.scheduler.timeline.tempos[0]?.bpm ?? 120);
    const beat = frame.measure ? frame.measure.index * frame.measure.beats + Math.floor(frame.beat) : Math.floor(frame.position / beatLength);
    if (this.metronome && beat !== this.lastBeat) this.click();
    this.lastBeat = beat;
    this.lastPosition = frame.position;
  }

  private sound(note: NoteEvent, tempoPercent: number): void {
    const duration = Math.max(0.04, note.durationSeconds / Math.max(0.5, tempoPercent / 100));
    this.instrument.play({ midi: note.midi, velocity: note.velocity, durationSeconds: duration });
  }

  private click(): void {
    this.instrument.metronome();
  }
}
