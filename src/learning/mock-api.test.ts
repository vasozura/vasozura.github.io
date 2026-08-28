import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import type { ScoreManifest } from "./contracts";
import { LocalLearningApi } from "./mock-api";

describe("contract-compatible local Learning API", () => {
  it("serves a v1 manifest, exercise, and deterministic attempt result", async () => {
    const manifest = fixture as ScoreManifest;
    const api = new LocalLearningApi({ [manifest.songId]: manifest });
    await expect(api.manifest(manifest.songId)).resolves.toMatchObject({ version: "v1", songId: manifest.songId });
    const [exercise] = await api.exercises(manifest.songId);
    expect(exercise).toMatchObject({ songId: manifest.songId, mode: "continuous" });
    await expect(api.evaluate(exercise.id, [{ midi: 67, startedAtMs: 0, durationMs: 625, velocity: 0.8 }])).resolves.toMatchObject({ exerciseId: exercise.id });
  });
});
