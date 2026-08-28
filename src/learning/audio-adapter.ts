import type { NoteEvent } from "./contracts";
import type { CanonicalScheduler, SchedulerFrame } from "./scheduler";

export class SchedulerAudioAdapter {
  private context: AudioContext | null = null;
  private played = new Set<string>();
  private lastBeat = -1;
  private metronome = false;
  private readonly frame = (event: Event): void => this.render((event as CustomEvent<SchedulerFrame>).detail);

  constructor(private scheduler: CanonicalScheduler) { scheduler.addEventListener("frame", this.frame); }

  async enable(): Promise<void> {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  reset(): void { this.played.clear(); this.lastBeat = -1; }

  destroy(): void {
    this.scheduler.removeEventListener("frame", this.frame);
    void this.context?.close();
    this.context = null;
  }

  private render(frame: SchedulerFrame): void {
    if (!this.context) return;
    frame.active.forEach((note) => { if (!this.played.has(note.id)) { this.played.add(note.id); this.sound(note); } });
    const beat = frame.measure ? frame.measure.index * frame.measure.beats + Math.floor(frame.beat) : -1;
    if (this.metronome && beat >= 0 && beat !== this.lastBeat) this.click();
    this.lastBeat = beat;
  }

  private sound(note: NoteEvent): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
    oscillator.type = "triangle";
    gain.gain.setValueAtTime(Math.max(0.01, note.velocity * 0.1), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + Math.max(0.04, note.durationSeconds));
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + Math.max(0.04, note.durationSeconds));
  }

  private click(): void {
    const context = this.context!;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = 1100; gain.gain.setValueAtTime(0.04, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.04);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.04);
  }
}
