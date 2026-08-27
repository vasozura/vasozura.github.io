interface MidiNoteEvent { time: number; duration: number; midi: number; velocity: number; }

export class MidiPlayback {
  private context: AudioContext | null = null;
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
  private readonly activeNotes = new Set<number>();

  constructor(private readonly onNotes: (activeMidiNotes: number[]) => void, private readonly onPosition: (seconds: number, duration: number) => void) {}

  async load(url: string, fallbackBpm = 120): Promise<void> {
    const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), fetch(url)]);
    if (!response.ok) throw new Error(`Unable to load MIDI (${response.status}).`);
    const midi = new Midi(await response.arrayBuffer());
    this.notes = midi.tracks.flatMap((track) => track.notes.map((note) => ({ time: note.time, duration: note.duration, midi: note.midi, velocity: note.velocity }))).sort((a, b) => a.time - b.time);
    this.duration = midi.duration;
    this.bpm = midi.header.tempos[0]?.bpm ?? fallbackBpm;
    this.offset = 0;
    this.onPosition(0, this.duration);
  }

  async play(): Promise<void> {
    if (!this.notes.length || this.playing) return;
    this.context ??= new AudioContext();
    await this.context.resume();
    this.playing = true;
    this.startedAt = this.context.currentTime;
    this.lastPosition = this.offset - 0.03;
    this.nextBeat = this.offset;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.position();
    this.playing = false;
    window.clearInterval(this.timer);
    this.activeNotes.clear();
    this.onNotes([]);
  }

  stop(): void {
    this.pause();
    this.offset = 0;
    this.lastPosition = 0;
    this.onPosition(0, this.duration);
  }

  setTempo(percent: number): void {
    const position = this.position();
    this.tempo = Math.min(1.5, Math.max(0.5, percent / 100));
    this.offset = position;
    if (this.playing && this.context) this.startedAt = this.context.currentTime;
  }

  setLoop(a: number | null, b: number | null): void {
    this.loopA = a !== null && a >= 0 ? a : null;
    this.loopB = b !== null && b > (this.loopA ?? -1) ? b : null;
  }

  setMetronome(enabled: boolean): void { this.metronome = enabled; }
  isPlaying(): boolean { return this.playing; }

  private position(): number {
    if (!this.playing || !this.context) return this.offset;
    return this.offset + (this.context.currentTime - this.startedAt) * this.tempo;
  }

  private tick(): void {
    let position = this.position();
    if (this.loopB !== null && position >= this.loopB) {
      this.offset = this.loopA ?? 0;
      if (this.context) this.startedAt = this.context.currentTime;
      this.lastPosition = this.offset - 0.03;
      this.nextBeat = this.offset;
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
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    oscillator.frequency.value = frequency;
    oscillator.type = "triangle";
    const now = this.context.currentTime;
    const length = Math.max(0.04, note.duration / this.tempo);
    gain.gain.setValueAtTime(Math.max(0.015, note.velocity * 0.12), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + length);
    this.activeNotes.add(note.midi);
    this.onNotes([...this.activeNotes]);
    window.setTimeout(() => { this.activeNotes.delete(note.midi); this.onNotes([...this.activeNotes]); }, length * 1000);
  }

  private click(): void {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = 1100;
    gain.gain.setValueAtTime(0.05, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.04);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.04);
  }
}
