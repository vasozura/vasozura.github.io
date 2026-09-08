import { SampleInstrumentEngine, type InstrumentPlayback } from "../audio/sample-instrument";

export interface MidiNoteEvent { time: number; duration: number; midi: number; velocity: number; }

export class MidiPlayback {
  private notes: MidiNoteEvent[] = [];
  private duration = 0;
  private timer = 0;
  private playing = false;
  private offset = 0;
  private startedAt = 0;
  private lastPosition = 0;
  private tempo = 1;
  private bpm = 120;
  private loopA: number | null = null;
  private loopB: number | null = null;
  private metronome = false;
  private nextBeat = 0;
  private readonly activeNotes = new Map<number, number>();
  private readonly noteTimers = new Set<number>();

  constructor(
    private readonly onNotes: (activeMidiNotes: number[]) => void,
    private readonly onPosition: (seconds: number, duration: number) => void,
    private readonly instrument: InstrumentPlayback = new SampleInstrumentEngine(),
  ) {}

  async load(url: string, fallbackBpm = 120): Promise<void> {
    const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), fetch(url)]);
    if (!response.ok) throw new Error(`Unable to load MIDI (${response.status}).`);
    const midi = new Midi(await response.arrayBuffer());
    this.loadEvents(midi.tracks.flatMap((track) => track.notes.map((note) => ({ time: note.time, duration: note.duration, midi: note.midi, velocity: note.velocity }))), midi.duration, midi.header.tempos[0]?.bpm ?? fallbackBpm);
  }

  loadEvents(notes: MidiNoteEvent[], duration: number, bpm = 120): void {
    this.stop();
    this.notes = notes.map((note) => ({ ...note })).sort((a, b) => a.time - b.time || a.midi - b.midi);
    this.duration = Math.max(0, duration);
    this.bpm = bpm;
    this.offset = 0;
    this.lastPosition = 0;
    this.onPosition(0, this.duration);
  }

  setInstrument(name: "piano" | "guitar"): void { this.instrument.setInstrument(name); }

  async play(): Promise<void> {
    if (!this.notes.length || this.playing) return;
    await this.instrument.enable(this.notes.map((note) => note.midi));
    this.playing = true;
    this.startedAt = this.instrument.currentTime;
    this.lastPosition = this.offset - 0.03;
    this.nextBeat = this.offset;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.position();
    this.playing = false;
    window.clearInterval(this.timer);
    this.clearActiveNotes();
    this.instrument.releaseAll();
  }

  stop(): void {
    this.pause();
    this.offset = 0;
    this.lastPosition = 0;
    this.onPosition(0, this.duration);
  }

  seek(seconds: number): void {
    const position = Math.min(this.duration, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    this.offset = position;
    this.lastPosition = position - 0.03;
    this.nextBeat = position;
    if (this.playing) this.startedAt = this.instrument.currentTime;
    this.clearActiveNotes();
    this.instrument.releaseAll();
    this.onPosition(position, this.duration);
  }

  setTempo(percent: number): void {
    const position = this.position();
    this.tempo = Math.min(1.5, Math.max(0.5, percent / 100));
    this.offset = position;
    if (this.playing) {
      this.startedAt = this.instrument.currentTime;
      this.instrument.releaseAll();
      this.clearActiveNotes();
    }
  }

  setLoop(a: number | null, b: number | null): void {
    this.loopA = a !== null && a >= 0 ? a : null;
    this.loopB = b !== null && b > (this.loopA ?? -1) ? b : null;
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  isPlaying(): boolean { return this.playing; }
  canPlay(): boolean { return this.notes.length > 0; }
  getDuration(): number { return this.duration; }
  getPosition(): number { return this.position(); }

  destroy(): void {
    this.pause();
    window.clearInterval(this.timer);
    this.instrument.destroy();
    this.notes = [];
  }

  private position(): number {
    if (!this.playing) return this.offset;
    return this.offset + (this.instrument.currentTime - this.startedAt) * this.tempo;
  }

  private tick(): void {
    let position = this.position();
    if (this.loopB !== null && position >= this.loopB) {
      this.offset = this.loopA ?? 0;
      this.startedAt = this.instrument.currentTime;
      this.lastPosition = this.offset - 0.03;
      this.nextBeat = this.offset;
      this.instrument.releaseAll();
      this.clearActiveNotes();
      position = this.offset;
    }
    if (position >= this.duration) { this.stop(); return; }
    for (const note of this.notes) {
      if (note.time > this.lastPosition && note.time <= position + 0.025) this.sound(note);
      if (note.time > position + 0.025) break;
    }
    if (this.metronome) {
      const beatLength = 60 / this.bpm;
      while (this.nextBeat <= position + 0.025) { if (this.nextBeat > this.lastPosition) this.click(); this.nextBeat += beatLength; }
    }
    this.lastPosition = position;
    this.onPosition(position, this.duration);
  }

  private sound(note: MidiNoteEvent): void {
    const length = Math.max(0.04, note.duration / this.tempo);
    this.instrument.play({ midi: note.midi, velocity: note.velocity, durationSeconds: length });
    this.activeNotes.set(note.midi, (this.activeNotes.get(note.midi) ?? 0) + 1);
    this.onNotes([...this.activeNotes.keys()]);
    const timer = window.setTimeout(() => {
      this.noteTimers.delete(timer);
      const remaining = (this.activeNotes.get(note.midi) ?? 1) - 1;
      if (remaining > 0) this.activeNotes.set(note.midi, remaining); else this.activeNotes.delete(note.midi);
      this.onNotes([...this.activeNotes.keys()]);
    }, length * 1000);
    this.noteTimers.add(timer);
  }

  private click(): void {
    this.instrument.metronome();
  }

  private clearActiveNotes(): void {
    for (const timer of this.noteTimers) window.clearTimeout(timer);
    this.noteTimers.clear();
    this.activeNotes.clear();
    this.onNotes([]);
  }
}
