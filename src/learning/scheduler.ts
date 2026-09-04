import type { Measure, NoteEvent, Timeline } from "./contracts";

export interface SchedulerFrame {
  position: number;
  duration: number;
  measure: Measure | null;
  beat: number;
  active: NoteEvent[];
  upcoming: NoteEvent[];
  reliable: boolean;
  playing: boolean;
  tempoPercent: number;
}

/** One monotonic clock for audio, notation, visualizers, metronome and loops. */
export class CanonicalScheduler extends EventTarget {
  private raf = 0;
  private playing = false;
  private position = 0;
  private anchor = 0;
  private anchoredAt = 0;
  private tempo = 1;
  private loop: [number, number] | null = null;
  private lastFrame = 0;

  constructor(readonly timeline: Timeline, private readonly clock = () => performance.now()) {
    super();
  }

  play(countInBeats = 0): void {
    if (this.playing) return;
    this.playing = true;
    this.anchoredAt = this.clock();
    this.anchor = Math.max(0, this.position - countInBeats * 60 / (this.timeline.tempos[0]?.bpm ?? 120));
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.updatePosition();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  stop(): void { this.pause(); this.seek(0); }

  seek(seconds: number): void {
    this.position = Math.max(0, Math.min(seconds, this.timeline.durationSeconds));
    this.anchor = this.position;
    this.anchoredAt = this.clock();
    this.emit();
  }

  setTempo(percent: number): void {
    this.updatePosition();
    this.tempo = Math.max(0.5, Math.min(1.5, percent / 100));
    this.anchor = this.position;
    this.anchoredAt = this.clock();
    this.emit();
  }

  setLoop(a: number | null, b: number | null): void {
    this.loop = a !== null && b !== null && b > a ? [a, b] : null;
    this.updatePosition();
    this.emit();
  }

  setMeasureLoop(a: number, b: number): void {
    const start = this.timeline.measures[a]?.startSeconds;
    const end = this.timeline.measures[b];
    this.setLoop(start ?? null, end ? end.startSeconds + end.durationSeconds : null);
  }

  snapshot(): SchedulerFrame {
    const measure = this.timeline.measures.find((item) => this.position >= item.startSeconds && this.position < item.startSeconds + item.durationSeconds) ?? null;
    const beat = measure ? 1 + (this.position - measure.startSeconds) / (measure.durationSeconds / measure.beats) : 0;
    return {
      position: this.position,
      duration: this.timeline.durationSeconds,
      measure,
      beat,
      active: this.timeline.notes.filter((note) => note.startSeconds <= this.position && note.startSeconds + note.durationSeconds > this.position),
      upcoming: this.timeline.notes.filter((note) => note.startSeconds > this.position && note.startSeconds <= this.position + 1),
      reliable: !this.lastFrame || this.clock() - this.lastFrame < 250,
      playing: this.playing,
      tempoPercent: Math.round(this.tempo * 100),
    };
  }

  destroy(): void { this.pause(); }

  private updatePosition(): void {
    if (this.playing) this.position = this.anchor + (this.clock() - this.anchoredAt) / 1000 * this.tempo;
    if (this.loop && this.position >= this.loop[1]) {
      const length = this.loop[1] - this.loop[0];
      this.position = this.loop[0] + (this.position - this.loop[0]) % length;
      this.anchor = this.position;
      this.anchoredAt = this.clock();
    }
    if (this.position >= this.timeline.durationSeconds) {
      this.position = this.timeline.durationSeconds;
      this.playing = false;
    }
  }

  private readonly tick = (): void => {
    if (!this.playing) return;
    this.updatePosition();
    this.lastFrame = this.clock();
    this.emit();
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };

  private emit(): void {
    this.dispatchEvent(new CustomEvent<SchedulerFrame>("frame", { detail: this.snapshot() }));
  }
}
