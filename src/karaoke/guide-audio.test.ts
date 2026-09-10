import { describe, expect, it } from "vitest";
import { instrumentSampleBank, nearestSample } from "../audio/sample-instrument";
import { encodeWav, guideEnvelope, guidePeak, guidePlaybackRate, guideSampleMidis, renderGuideTrack, type GuideSample } from "./guide-audio";
import { createLearningNotes } from "./vocal-midi";

const sampleRate = 8000;
const piano = instrumentSampleBank("piano");
const note = (id: string, midi: number, startSeconds: number, durationSeconds: number, velocity = .8) => ({ id, midi, startSeconds, durationSeconds, velocity, confidence: .9, pitchConfidence: .9, sourceTimestampSeconds: startSeconds });
/** A one-second sine, so a rendered note is easy to locate and measure. */
const tone = (frequency: number, seconds: number): Float32Array => Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_unused, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate));
const bankSamples = (midis: readonly number[], seconds = 1): GuideSample[] => midis.map((midi) => ({ midi, pcm: tone(440, seconds) }));

describe("offline guide track", () => {
  it("uses the same nearest sample and playback rate as the browser engine", () => {
    expect(nearestSample(61, piano).midi).toBe(60);
    expect(guidePlaybackRate(61, 60)).toBeCloseTo(2 ** (1 / 12), 10);
    expect(guidePlaybackRate(60, 60)).toBe(1);
  });

  it("reproduces the browser velocity curve", () => {
    expect(guidePeak(0)).toBeCloseTo(0.035, 6);
    expect(guidePeak(1)).toBeCloseTo(0.345, 6);
    expect(guidePeak(0.0001)).toBeGreaterThanOrEqual(0.018);
    expect(guidePeak(5)).toBeLessThanOrEqual(0.42);
  });

  it("ramps in, holds and releases like the Web Audio envelope", () => {
    const peak = guidePeak(0.8);
    expect(guideEnvelope(-0.1, 1, peak)).toBe(0);
    expect(guideEnvelope(0, 1, peak)).toBeCloseTo(0.0001, 6);
    expect(guideEnvelope(0.012, 1, peak)).toBeCloseTo(peak, 6);
    expect(guideEnvelope(0.5, 1, peak)).toBe(peak);
    expect(guideEnvelope(1.35, 1, peak)).toBeLessThan(peak);
    expect(guideEnvelope(1.7, 1, peak)).toBe(0);
  });

  it("decodes only the bank samples the melody actually needs", () => {
    const notes = createLearningNotes([note("a", 60, 0, .5), note("b", 61, 1, .5), note("c", 84, 2, .5)]);
    expect(guideSampleMidis(notes, piano).map((sample) => sample.midi)).toEqual([60, 84]);
  });

  it("places each note at its own start time", () => {
    const notes = createLearningNotes([note("a", 60, 0, .2), note("b", 60, 1, .2)]);
    const { pcm } = renderGuideTrack(notes, bankSamples([60]), piano, { sampleRate, totalSeconds: 2 });
    const energy = (from: number, to: number): number => pcm.slice(Math.round(from * sampleRate), Math.round(to * sampleRate)).reduce((sum, value) => sum + Math.abs(value), 0);
    expect(energy(0, .3)).toBeGreaterThan(0);
    expect(energy(1, 1.3)).toBeGreaterThan(0);
    // The gap between the two notes only carries the first note's release tail.
    expect(energy(.95, 1)).toBeLessThan(energy(0, .05));
  });

  it("reports the samples it could not find instead of rendering silence unannounced", () => {
    const notes = createLearningNotes([note("a", 60, 0, .3), note("b", 84, .5, .3)]);
    const result = renderGuideTrack(notes, bankSamples([60]), piano, { sampleRate, totalSeconds: 1 });
    expect(result.missingSamples).toEqual([84]);
  });

  it("scales an overloaded mix instead of clipping it", () => {
    const loud: GuideSample[] = [{ midi: 60, pcm: new Float32Array(sampleRate).fill(1) }];
    const notes = createLearningNotes(Array.from({ length: 24 }, (_unused, index) => note(`n${index}`, 60, 0, .5, 1)));
    const result = renderGuideTrack(notes, loud, piano, { sampleRate, totalSeconds: 1 });
    expect(result.normalizedBy).toBeLessThan(1);
    expect(result.peakAmplitude).toBeLessThanOrEqual(1);
    expect(Math.max(...result.pcm)).toBeLessThanOrEqual(1);
  });

  it("stays inside the requested length", () => {
    const notes = createLearningNotes([note("a", 60, 1.9, 2)]);
    const { pcm } = renderGuideTrack(notes, bankSamples([60]), piano, { sampleRate, totalSeconds: 2 });
    expect(pcm.length).toBe(2 * sampleRate);
  });

  it("applies the requested mix gain", () => {
    const notes = createLearningNotes([note("a", 60, 0, .3)]);
    const full = renderGuideTrack(notes, bankSamples([60]), piano, { sampleRate, totalSeconds: 1 });
    const quiet = renderGuideTrack(notes, bankSamples([60]), piano, { sampleRate, totalSeconds: 1, gain: .5 });
    expect(quiet.peakAmplitude).toBeCloseTo(full.peakAmplitude / 2, 5);
  });

  it("supports the guitar bank as well as the piano bank", () => {
    const guitar = instrumentSampleBank("guitar");
    expect(guitar.map((sample) => sample.midi)).toEqual([38, 48, 60, 72]);
    const notes = createLearningNotes([note("a", 55, 0, .3)]);
    expect(guideSampleMidis(notes, guitar).map((sample) => sample.midi)).toEqual([60]);
  });

  it("writes a 16-bit mono WAV FFmpeg can read", () => {
    const wav = encodeWav(Float32Array.from([0, .5, -.5, 1, -1]), 44100);
    const text = new TextDecoder("latin1").decode(wav.slice(0, 4));
    const view = new DataView(wav.buffer);
    expect(text).toBe("RIFF");
    expect(new TextDecoder("latin1").decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 6, true)).toBe(32767);
    expect(view.getInt16(44 + 8, true)).toBe(-32767);
  });
});
