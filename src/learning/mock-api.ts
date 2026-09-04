import type { LearningApi } from "./api-client";
import type { AttemptEvent, AttemptResult, Exercise, ExerciseSelection, LearnerProgress, LearningAttemptSummary, LearningResetResult, ProgressSummary, ScoreManifest } from "./contracts";
import { evaluateAttempt } from "./practice";

export class LocalLearningApi implements LearningApi {
  constructor(private manifests: Record<string, ScoreManifest> = {}) {}

  async manifest(songId: string): Promise<ScoreManifest> {
    const value = this.manifests[songId];
    if (!value) throw new Error("No local learning fixture for this song.");
    return structuredClone(value);
  }

  async exercises(songId: string, selection?: ExerciseSelection): Promise<Exercise[]> {
    const manifest = await this.manifest(songId);
    return [{ id: `${songId}-all`, songId, partIds: selection?.partIds ?? manifest.parts.map((part) => part.id), fromMeasure: Math.max(0, (selection?.fromMeasure ?? 1) - 1), toMeasure: Math.max(0, (selection?.toMeasure ?? manifest.timeline.measures.length) - 1), tempoPercent: selection?.tempoPercent ?? 100, mode: "continuous", timingToleranceMs: 150 }];
  }

  async evaluate(exerciseId: string, events: AttemptEvent[]): Promise<AttemptResult> {
    const songId = exerciseId.replace(/-all$/, "");
    const manifest = await this.manifest(songId);
    return evaluateAttempt({ id: exerciseId, songId, partIds: manifest.parts.map((part) => part.id), fromMeasure: 0, toMeasure: 999, tempoPercent: 100, mode: "continuous", timingToleranceMs: 150 }, manifest.timeline.notes, events);
  }

  async saveProgress(summary: ProgressSummary): Promise<void> {
    localStorage.setItem(`zura-learning:${summary.songId}`, JSON.stringify(summary));
  }

  async history(): Promise<LearningAttemptSummary[]> { return []; }

  async progress(songId: string): Promise<LearnerProgress> {
    const saved = localStorage.getItem(`zura-learning:${songId}`);
    const summary = saved ? JSON.parse(saved) as ProgressSummary : null;
    return { attempts: summary ? 1 : 0, bestScore: summary?.bestScore ?? null, recentScore: summary?.bestScore ?? null, totalPracticeSeconds: summary?.practiceSeconds ?? 0, streak: summary?.streak ?? 0, lastPracticedAt: summary?.lastPracticedAt ?? null };
  }

  async reset(songId: string): Promise<LearningResetResult> {
    const existed = localStorage.getItem(`zura-learning:${songId}`) !== null;
    localStorage.removeItem(`zura-learning:${songId}`);
    return { deletedAttempts: 0, deletedProgressEntries: existed ? 1 : 0 };
  }
}
