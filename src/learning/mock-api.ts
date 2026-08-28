import type { LearningApi } from "./api-client";
import type { AttemptEvent, AttemptResult, Exercise, ProgressSummary, ScoreManifest } from "./contracts";
import { evaluateAttempt } from "./practice";

export class LocalLearningApi implements LearningApi {
  constructor(private manifests: Record<string, ScoreManifest> = {}) {}

  async manifest(songId: string): Promise<ScoreManifest> {
    const value = this.manifests[songId];
    if (!value) throw new Error("No local learning fixture for this song.");
    return structuredClone(value);
  }

  async exercises(songId: string): Promise<Exercise[]> {
    const manifest = await this.manifest(songId);
    return [{ id: `${songId}-all`, songId, partIds: manifest.parts.map((part) => part.id), fromMeasure: 0, toMeasure: manifest.timeline.measures.length - 1, tempoPercent: 100, mode: "continuous", timingToleranceMs: 150 }];
  }

  async evaluate(exerciseId: string, events: AttemptEvent[]): Promise<AttemptResult> {
    const songId = exerciseId.replace(/-all$/, "");
    const manifest = await this.manifest(songId);
    return evaluateAttempt({ id: exerciseId, songId, partIds: manifest.parts.map((part) => part.id), fromMeasure: 0, toMeasure: 999, tempoPercent: 100, mode: "continuous", timingToleranceMs: 150 }, manifest.timeline.notes, events);
  }

  async saveProgress(summary: ProgressSummary): Promise<void> {
    localStorage.setItem(`zura-learning:${summary.songId}`, JSON.stringify(summary));
  }
}
