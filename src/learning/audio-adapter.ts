import type { NoteEvent } from "./contracts";
import type { CanonicalScheduler, SchedulerFrame } from "./scheduler";

export class SchedulerAudioAdapter {
  private context: AudioContext | null = null;
  private played = new Set<string>();
  private lastBeat = -1;
  private lastPosition = 0;
  private metronome = false;
  private readonly frame = (event: Event): void => this.render((event as CustomEvent<SchedulerFrame>).detail);

  constructor(private scheduler: CanonicalScheduler) { scheduler.addEventListener("frame", this.frame); }

  async enable(): Promise<void> {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  reset(): void { this.played.clear(); this.lastBeat = -1; this.lastPosition = 0; }

  destroy(): void {
    this.scheduler.removeEventListener("frame", this.frame);
    void this.context?.close();
    this.context = null;
  }

  private render(frame: SchedulerFrame): void {
    if (!this.context) return;
    if (frame.position + 0.01 < this.lastPosition) this.played.clear();
    frame.active.forEach((note) => { if (!this.played.has(note.id)) { this.played.add(note.id); this.sound(note, frame.tempoPercent); } });
    const beatLength = 60 / (this.scheduler.timeline.tempos[0]?.bpm ?? 120);
    const beat = frame.measure ? frame.measure.index * frame.measure.beats + Math.floor(frame.beat) : Math.floor(frame.position / beatLength);
    if (this.metronome && beat !== this.lastBeat) this.click();
    this.lastBeat = beat;
    this.lastPosition = frame.position;
  }

  private sound(note: NoteEvent, tempoPercent: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
    oscillator.type = "triangle";
    gain.gain.setValueAtTime(Math.max(0.01, note.velocity * 0.1), context.currentTime);
    const duration = Math.max(0.04, note.durationSeconds / Math.max(0.5, tempoPercent / 100));
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration);
  }

  private click(): void {
    const context = this.context!;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = 1100; gain.gain.setValueAtTime(0.04, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.04);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.04);
  }
}
