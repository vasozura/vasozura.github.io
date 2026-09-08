export type InstrumentName = "piano" | "guitar" | "accordion";

export interface InstrumentNote {
  midi: number;
  velocity: number;
  durationSeconds: number;
}

export interface InstrumentPlayback {
  readonly currentTime: number;
  enable(midiNotes?: readonly number[]): Promise<void>;
  play(note: InstrumentNote): void;
  releaseAll(): void;
  metronome(): void;
  setInstrument(instrument: InstrumentName): void;
  destroy(): void;
}

interface SampleDefinition { midi: number; file: string; }
interface Voice { source: AudioBufferSourceNode | OscillatorNode; gain: GainNode; }

const pianoSamples: readonly SampleDefinition[] = [
  { midi: 21, file: "A0.mp3" },
  { midi: 24, file: "C1.mp3" },
  { midi: 27, file: "Ds1.mp3" },
  { midi: 30, file: "Fs1.mp3" },
  { midi: 33, file: "A1.mp3" },
  { midi: 36, file: "C2.mp3" },
  { midi: 39, file: "Ds2.mp3" },
  { midi: 42, file: "Fs2.mp3" },
  { midi: 45, file: "A2.mp3" },
  { midi: 48, file: "C3.mp3" },
  { midi: 51, file: "Ds3.mp3" },
  { midi: 54, file: "Fs3.mp3" },
  { midi: 57, file: "A3.mp3" },
  { midi: 60, file: "C4.mp3" },
  { midi: 63, file: "Ds4.mp3" },
  { midi: 66, file: "Fs4.mp3" },
  { midi: 69, file: "A4.mp3" },
  { midi: 72, file: "C5.mp3" },
  { midi: 75, file: "Ds5.mp3" },
  { midi: 78, file: "Fs5.mp3" },
  { midi: 81, file: "A5.mp3" },
  { midi: 84, file: "C6.mp3" },
  { midi: 87, file: "Ds6.mp3" },
  { midi: 90, file: "Fs6.mp3" },
  { midi: 93, file: "A6.mp3" },
  { midi: 96, file: "C7.mp3" },
] as const;

// Real acoustic-guitar samples from nbrosowsky/tonejs-instruments (CC BY 3.0).
// Sparse roots keep the lazy-loaded bank small; playbackRate preserves source MIDI pitch.
const guitarSamples: readonly SampleDefinition[] = [
  { midi: 38, file: "D2.mp3" },
  { midi: 48, file: "C3.mp3" },
  { midi: 60, file: "C4.mp3" },
  { midi: 72, file: "C5.mp3" },
] as const;

const sampleBanks: Partial<Record<InstrumentName, readonly SampleDefinition[]>> = {
  piano: pianoSamples,
  guitar: guitarSamples,
};

const decodedBuffers = new Map<string, Promise<AudioBuffer>>();

export const sampledPianoFiles = pianoSamples.map((sample) => sample.file);
export const sampledGuitarFiles = guitarSamples.map((sample) => sample.file);

export function nearestSample(midi: number, samples: readonly SampleDefinition[] = pianoSamples): SampleDefinition {
  return samples.reduce((nearest, sample) => (
    Math.abs(sample.midi - midi) < Math.abs(nearest.midi - midi) ? sample : nearest
  ));
}

export class SampleInstrumentEngine implements InstrumentPlayback {
  private context: AudioContext | null = null;
  private instrument: InstrumentName = "piano";
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly failedSamples = new Set<string>();
  private readonly voices = new Set<Voice>();

  constructor(private readonly contextFactory: () => AudioContext = () => new AudioContext()) {}

  get currentTime(): number { return this.context?.currentTime ?? 0; }
  get currentInstrument(): InstrumentName { return this.instrument; }

  setInstrument(instrument: InstrumentName): void {
    this.releaseAll();
    this.instrument = instrument;
  }

  async enable(midiNotes: readonly number[] = [60]): Promise<void> {
    this.context ??= this.contextFactory();
    await this.context.resume();
    const context = this.context;
    const instrument = this.instrument;
    const bank = this.bank();
    const required = new Map(midiNotes.map((midi) => {
      const sample = nearestSample(midi, bank);
      return [sample.midi, sample] as const;
    }));
    await Promise.all([...required.values()].map(async (sample) => {
      const key = `${instrument}:${sample.midi}`;
      if (this.buffers.has(key) || this.failedSamples.has(key)) return;
      try {
        const url = this.sampleUrl(sample.file, instrument);
        let pending = decodedBuffers.get(url);
        if (!pending) {
          pending = fetch(url, { credentials: "same-origin" }).then(async (response) => {
            if (!response.ok) throw new Error(`${instrument} sample unavailable (${response.status}).`);
            return context.decodeAudioData(await response.arrayBuffer());
          });
          decodedBuffers.set(url, pending);
        }
        this.buffers.set(key, await pending);
      } catch {
        this.failedSamples.add(key);
      }
    }));
    if (instrument !== "piano" && [...required].some(([midi]) => !this.buffers.has(`${instrument}:${midi}`))) {
      throw new Error(instrument === "guitar" ? "Guitar audio unavailable." : "Accordion audio unavailable.");
    }
  }

  play(note: InstrumentNote): void {
    const context = this.context;
    if (!context) return;
    const bank = sampleBanks[this.instrument];
    if (!bank) return;
    const sample = nearestSample(note.midi, bank);
    const buffer = this.buffers.get(`${this.instrument}:${sample.midi}`);
    if (!buffer) {
      if (this.instrument !== "piano") return;
      this.playEmergencyFallback(note);
      return;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = context.currentTime;
    const attack = 0.012;
    const release = 0.7;
    const heldFor = Math.max(0.05, note.durationSeconds);
    const peak = Math.max(0.018, Math.min(0.42, 0.035 + Math.pow(note.velocity, 1.35) * 0.31));
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((note.midi - sample.midi) / 12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.setValueAtTime(peak, now + heldFor);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + heldFor + release);
    source.connect(gain).connect(context.destination);
    const voice = { source, gain };
    this.voices.add(voice);
    source.addEventListener("ended", () => this.voices.delete(voice), { once: true });
    source.start(now);
    source.stop(now + heldFor + release + 0.05);
  }

  releaseAll(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        voice.source.stop(now + 0.09);
      } catch { /* Voice may already have ended. */ }
    }
    this.voices.clear();
  }

  metronome(): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.04);
  }

  destroy(): void {
    this.releaseAll();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.failedSamples.clear();
  }

  private bank(): readonly SampleDefinition[] {
    const bank = sampleBanks[this.instrument];
    if (!bank) throw new Error("Accordion audio unavailable.");
    return bank;
  }

  private sampleUrl(file: string, instrument: InstrumentName = this.instrument): string {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const directory = instrument === "guitar" ? "guitar-acoustic" : "salamander";
    return `${base}audio/${directory}/${file}`;
  }

  private playEmergencyFallback(note: InstrumentNote): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const duration = Math.max(0.04, note.durationSeconds);
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
    gain.gain.setValueAtTime(Math.max(0.008, note.velocity * 0.045), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    const voice = { source: oscillator, gain };
    this.voices.add(voice);
    oscillator.addEventListener("ended", () => this.voices.delete(voice), { once: true });
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
