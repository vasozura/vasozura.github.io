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
});
