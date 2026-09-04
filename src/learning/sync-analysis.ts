import type { Timeline } from "./contracts";

export type SynchronizationConfidence = "high" | "medium" | "unreliable";

export interface SynchronizationAssessment {
  confidence: SynchronizationConfidence;
  differenceSeconds: number;
  differenceRatio: number;
  message: string;
}

/** Compare an optional performance MIDI with the authoritative canonical timeline. */
export function assessSynchronization(
  timeline: Timeline,
  midiDurationSeconds: number | null,
): SynchronizationAssessment {
  if (!midiDurationSeconds || !Number.isFinite(midiDurationSeconds)) {
    return { confidence: "unreliable", differenceSeconds: 0, differenceRatio: 1, message: "MIDI timing could not be verified; the canonical score timeline is used." };
  }
  const differenceSeconds = Math.abs(timeline.durationSeconds - midiDurationSeconds);
  const differenceRatio = differenceSeconds / Math.max(timeline.durationSeconds, midiDurationSeconds);
  if (differenceSeconds <= 0.1 || differenceRatio <= 0.005) {
    return { confidence: "high", differenceSeconds, differenceRatio, message: "Score and MIDI timing are aligned." };
  }
  if (differenceSeconds <= 0.75 || differenceRatio <= 0.025) {
    return { confidence: "medium", differenceSeconds, differenceRatio, message: "Small score/MIDI timing differences are normalized to the canonical timeline." };
  }
  return { confidence: "unreliable", differenceSeconds, differenceRatio, message: "Reliable score/MIDI synchronization is unavailable; canonical score timing is used." };
}

export async function readMidiDuration(
  url: string | undefined,
  request: typeof fetch = fetch,
): Promise<number | null> {
  if (!url) return null;
  const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), request(url)]);
  if (!response.ok) throw new Error(`MIDI unavailable (${response.status}).`);
  return new Midi(await response.arrayBuffer()).duration;
}
