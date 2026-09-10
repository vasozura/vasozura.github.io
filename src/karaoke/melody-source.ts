import type { KaraokeMelodyLane, KaraokeMelodySource, VocalMidiDiagnostics } from "./contracts";

/** Choosing the study melody lane.
 *
 * The lane is resolved once, during preparation, and written into the manifest. The browser reads
 * the decision instead of making it, so a lane can never change while a student is playing: the
 * melody a song shows on Monday is the melody it shows on Friday unless the artifacts are
 * regenerated.
 *
 * Priority, highest first:
 *   1. a manually approved melody;
 *   2. an MP3-derived vocal melody that passed its own diagnostics;
 *   3. an explicit Vocal/Melody MIDI file;
 *   4. an MP3-derived vocal melody that did not pass (kept, but marked for review);
 *   5. an inferred melody.
 *
 * Rules 2 and 4 are the same lane at two confidence levels: an extraction the diagnostics do not
 * trust should not outrank a MIDI file a human supplied, but it is still better than inference. */

export interface MelodyCandidate {
  lane: KaraokeMelodyLane;
  available: boolean;
  noteCount: number;
  /** Only meaningful for the `mp3-vocal` lane; decides whether it outranks an explicit MIDI. */
  diagnostics?: VocalMidiDiagnostics | null;
  /** Overrides the default human label, e.g. the MIDI file name. */
  label?: string;
}

const defaultLabels: Record<KaraokeMelodyLane, string> = {
  manual: "Manually approved melody",
  "mp3-vocal": "MP3 Vocal Extraction",
  "vocal-midi": "Vocal / Melody MIDI",
  inferred: "Inferred melody",
};

const usable = (candidate: MelodyCandidate | undefined): candidate is MelodyCandidate =>
  Boolean(candidate?.available && candidate.noteCount > 0);

const highConfidence = (candidate: MelodyCandidate): boolean => candidate.diagnostics?.status === "verified";

export const notPreparedMelody: KaraokeMelodySource = {
  lane: "inferred",
  label: "Not prepared",
  confidence: "review",
  reason: "No melody lane supplied any notes.",
};

export function resolveMelodySource(candidates: readonly MelodyCandidate[]): KaraokeMelodySource {
  const byLane = new Map(candidates.map((candidate) => [candidate.lane, candidate]));
  const manual = byLane.get("manual");
  const extraction = byLane.get("mp3-vocal");
  const midi = byLane.get("vocal-midi");
  const inferred = byLane.get("inferred");
  const describe = (candidate: MelodyCandidate, confidence: KaraokeMelodySource["confidence"], reason: string): KaraokeMelodySource =>
    ({ lane: candidate.lane, label: candidate.label ?? defaultLabels[candidate.lane], confidence, reason });

  if (usable(manual)) return describe(manual, "verified", "A manually approved melody is available and always wins.");
  if (usable(extraction) && highConfidence(extraction)) {
    return describe(extraction, "verified", `Vocal extraction passed its diagnostics (${extraction.noteCount} notes, confidence ${extraction.diagnostics!.pitchConfidence}).`);
  }
  if (usable(midi)) return describe(midi, "verified", "An explicit Vocal/Melody MIDI outranks an extraction the diagnostics did not trust.");
  if (usable(extraction)) {
    return describe(extraction, "review", `Vocal extraction is the only melody available and needs review (confidence ${extraction.diagnostics?.pitchConfidence ?? 0}).`);
  }
  if (usable(inferred)) return describe(inferred, "inferred", "Only an inferred melody is available.");
  return notPreparedMelody;
}
