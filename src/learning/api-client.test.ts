import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { LearningApiClient, LearningClientError } from "./api-client";

afterEach(() => vi.restoreAllMocks());

describe("Learning API client", () => {
  it("sends the version header and accepts a v1 manifest", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(new LearningApiClient("https://learning.test").manifest("song one")).resolves.toMatchObject({ version: "v1" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Learning-Api-Version")).toBe("v1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://learning.test/v1/songs/song%20one/manifest");
  });

  it("surfaces stable non-retryable errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "invalid_score", message: "Invalid score" }), { status: 422 }));
    await expect(new LearningApiClient("https://learning.test").manifest("x")).rejects.toMatchObject({ code: "invalid_score", retryable: false } satisfies Partial<LearningClientError>);
  });
});
