import { afterEach, describe, expect, it, vi } from "vitest";
import exerciseFixture from "./fixtures/api-exercise.json";
import manifestFixture from "./fixtures/api-manifest.json";
import timelineFixture from "./fixtures/api-timeline.json";

const getSession = vi.fn(async () => ({
  data: { session: { access_token: "test-token" } },
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ auth: { getSession } }),
}));

import { LearningApiClient, LearningClientError } from "./api-client";

afterEach(() => {
  vi.restoreAllMocks();
  getSession.mockClear();
});

describe("Learning API adapter", () => {
  it("maps generated manifest and timeline contracts without sending a token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(manifestFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(timelineFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const result = await new LearningApiClient("https://learning.test").manifest(
      "example-song",
    );
    expect(result).toMatchObject({ version: "v1", songId: "example-song" });
    expect(result.timeline.notes[0]).toMatchObject({ midi: 60, cursorStep: 0 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://learning.test/v1/scores/example-song/manifest",
      "https://learning.test/v1/scores/example-song/timeline",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(init?.credentials).toBe("omit");
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses the current Supabase access token only for protected requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(exerciseFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      new LearningApiClient("https://learning.test").exercises("example-song"),
    ).resolves.toHaveLength(1);

    expect(fetchMock.mock.calls[0][0]).toBe("https://learning.test/v1/exercises/generate");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("surfaces stable API errors from the generated client", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: "invalid_score",
          message: "Invalid score",
          status_code: 422,
          request_id: "req-test",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      new LearningApiClient("https://learning.test").manifest("x"),
    ).rejects.toMatchObject({
      code: "invalid_score",
      status: 422,
    } satisfies Partial<LearningClientError>);
  });

  it("authenticates private draft manifest and timeline reads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(manifestFixture), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(timelineFixture), { status: 200, headers: { "content-type": "application/json" } }));

    await new LearningApiClient("https://learning.test", 30_000, undefined, true).manifest("example-song");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      expect(init?.credentials).toBe("omit");
    }
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("keeps history, progress and confirmed reset on protected generated-client routes", async () => {
    const attempt = {
      attempt_id: "at-1", exercise_id: "ex-1", song_id: "song-1", user_id: "user-1",
      algorithm_version: "1", evaluated_at: "2026-01-01T00:00:00Z", expected_count: 1,
      correct_count: 1, wrong_count: 0, missed_count: 0, extra_count: 0,
      metrics: { pitch_accuracy: 1, onset_timing: 0.9, duration_accuracy: 1, completion: 1, longest_streak_notes: 1 },
      matches: [], attempt_duration_seconds: 1, notes_played: 1, tolerances: {},
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([attempt]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attempts: 1, best_accuracy: 1, latest_accuracy: 0.9, total_practice_seconds: 4, longest_streak_notes: 1, last_attempt_at: attempt.evaluated_at, recent: [], user_id: "user-1", song_id: "song-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: "user-1", song_id: "song-1", deleted_attempts: 1, deleted_progress_entries: 1 }), { status: 200 }));
    const api = new LearningApiClient("https://learning.test");
    await expect(api.history("song-1")).resolves.toHaveLength(1);
    await expect(api.progress("song-1")).resolves.toMatchObject({ attempts: 1, bestScore: 100 });
    await expect(api.reset("song-1")).resolves.toEqual({ deletedAttempts: 1, deletedProgressEntries: 1 });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET", "DELETE"]);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("associates attempt history with instruments from the immutable manifest", async () => {
    const attempt = {
      attempt_id: "at-piano", exercise_id: "ex-piano", song_id: "example-song", user_id: "user-1",
      algorithm_version: "1", evaluated_at: "2026-01-01T00:00:00Z", expected_count: 1,
      correct_count: 1, wrong_count: 0, missed_count: 0, extra_count: 0,
      metrics: { pitch_accuracy: 1, onset_timing: 1, duration_accuracy: 1, completion: 1, longest_streak_notes: 1 },
      matches: [{ status: "correct", part_id: "P1", expected_midi: 60, played_midi: 60, within_tolerance: true }],
      attempt_duration_seconds: 1, notes_played: 1, tolerances: {},
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(manifestFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(timelineFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([attempt]), { status: 200 }));
    const api = new LearningApiClient("https://learning.test");
    await api.manifest("example-song");
    await expect(api.history("example-song")).resolves.toEqual([
      expect.objectContaining({ instruments: ["piano"] }),
    ]);
  });
});
