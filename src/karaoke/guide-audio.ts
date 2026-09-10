import { nearestSample, type SampleDefinition } from "../audio/sample-instrument";
import type { LearningVocalNote } from "./contracts";

/** Offline guide-track synthesis.
 *
 * The rendered guide has to sound like the guide the student hears in the browser, so this
 * reproduces SampleInstrumentEngine.play exactly: the same nearest-sample choice, the same
 * playbackRate, the same attack/hold/release envelope and the same sustain loop. Keeping both in
 * one file would mean pulling Web Audio into Node, so the shared parts - the sample banks and
 * nearestSample - are imported and only the scheduling is reimplemented here.
 *
 * Everything is a pure function over Float32 PCM, so the mix is unit-testable without FFmpeg. */

export interface GuideSample {
  midi: number;
  /** Mono PCM at `sampleRate`, as decoded from the bank file. */
  pcm: Float32Array;
}

export interface GuideRenderOptions {
  sampleRate: number;
  /** Length of the rendered track. Release tails past this point are cut. */
  totalSeconds: number;
  /** Applied to the whole mix before the clipping guard. */
  gain?: number;
}

const attackSeconds = 0.012;
const releaseSeconds = 0.7;
const silence = 0.0001;

export function guidePeak(velocity: number): number {
  return Math.max(0.018, Math.min(0.42, 0.035 + Math.pow(velocity, 1.35) * 0.31));
}

export function guidePlaybackRate(midi: number, sampleMidi: number): number {
  return 2 ** ((midi - sampleMidi) / 12);
}

/** Web Audio exponential ramps, evaluated directly: 0.0001 -> peak over the attack, hold, then
 *  peak -> 0.0001 over the release. */
export function guideEnvelope(elapsedSeconds: number, heldSeconds: number, peak: number): number {
  if (elapsedSeconds < 0) return 0;
  if (elapsedSeconds < attackSeconds) return silence * (peak / silence) ** (elapsedSeconds / attackSeconds);
  if (elapsedSeconds < heldSeconds) return peak;
  const releasing = elapsedSeconds - heldSeconds;
  if (releasing >= releaseSeconds) return 0;
  return peak * (silence / peak) ** (releasing / releaseSeconds);
}

/** Which bank samples a set of notes actually needs, so only those files are decoded. */
export function guideSampleMidis(notes: readonly LearningVocalNote[], bank: readonly SampleDefinition[]): SampleDefinition[] {
  const required = new Map<number, SampleDefinition>();
  for (const note of notes) {
    const sample = nearestSample(note.midi, bank);
    required.set(sample.midi, sample);
  }
  return [...required.values()].sort((left, right) => left.midi - right.midi);
}

function readSample(pcm: Float32Array, position: number): number {
  const index = Math.floor(position);
  if (index < 0 || index + 1 >= pcm.length) return pcm[index] ?? 0;
  const fraction = position - index;
  return pcm[index] * (1 - fraction) + pcm[index + 1] * fraction;
}

export interface GuideRenderResult {
  pcm: Float32Array;
  /** Notes whose nearest sample was not supplied, so they are silent in the mix. */
  missingSamples: number[];
  /** Set when the summed mix exceeded full scale and was scaled down to fit. */
  normalizedBy: number;
  peakAmplitude: number;
}

export function renderGuideTrack(notes: readonly LearningVocalNote[], samples: readonly GuideSample[], bank: readonly SampleDefinition[], options: GuideRenderOptions): GuideRenderResult {
  const { sampleRate, totalSeconds } = options;
  if (sampleRate <= 0) throw new Error("A guide track needs a positive sample rate.");
  const frames = Math.max(1, Math.ceil(totalSeconds * sampleRate));
  const output = new Float32Array(frames);
  const byMidi = new Map(samples.map((sample) => [sample.midi, sample.pcm]));
  const missing = new Set<number>();

  for (const note of notes) {
    const definition = nearestSample(note.midi, bank);
    const source = byMidi.get(definition.midi);
    if (!source || !source.length) { missing.add(definition.midi); continue; }

    const rate = guidePlaybackRate(note.midi, definition.midi);
    const held = Math.max(0.05, note.durationSeconds);
    const peak = guidePeak(note.velocity);
    const sourceSeconds = source.length / sampleRate;
    const audibleSeconds = sourceSeconds / rate;
    const looping = held > audibleSeconds * 0.92 && sourceSeconds > 0.3;
    const loopStart = Math.min(sourceSeconds * 0.38, Math.max(0.08, sourceSeconds - 0.2)) * sampleRate;
    const loopEnd = Math.max(loopStart + 0.08 * sampleRate, sourceSeconds * 0.88 * sampleRate);
    const loopLength = loopEnd - loopStart;

    const startFrame = Math.round(note.startSeconds * sampleRate);
    const voiceFrames = Math.ceil((held + releaseSeconds) * sampleRate);
    for (let offset = 0; offset < voiceFrames; offset += 1) {
      const target = startFrame + offset;
      if (target < 0) continue;
      if (target >= frames) break;
      let position = offset * rate;
      if (looping && position >= loopEnd) position = loopStart + ((position - loopStart) % loopLength);
      if (position >= source.length) continue;
      output[target] += readSample(source, position) * guideEnvelope(offset / sampleRate, held, peak);
    }
  }

  const gain = options.gain ?? 1;
  let amplitude = 0;
  for (let index = 0; index < output.length; index += 1) {
    output[index] *= gain;
    amplitude = Math.max(amplitude, Math.abs(output[index]));
  }
  // Overlapping sustains can sum past full scale. Scale the whole mix rather than clipping, so
  // the guide keeps its dynamics and never distorts against the instrumental.
  const normalizedBy = amplitude > 1 ? 1 / amplitude : 1;
  if (normalizedBy < 1) for (let index = 0; index < output.length; index += 1) output[index] *= normalizedBy;
  return { pcm: output, missingSamples: [...missing].sort((left, right) => left - right), normalizedBy, peakAmplitude: Math.min(amplitude, 1) };
}

/** 16-bit PCM WAV, which every FFmpeg build reads without extra flags. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < pcm.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, pcm[index]));
    view.setInt16(44 + index * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}
