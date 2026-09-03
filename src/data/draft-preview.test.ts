import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  getSupabase: () => null,
  requireSupabase: () => ({ auth: { getSession }, from, rpc }),
}));

import { loadOwnerDraftPreview } from "./song-repository";

const row = {
  id: "7037edfc-52ef-4ba2-a031-bbfccde66ac3",
  slug: "taflis-tvali",
  status: "draft",
  title_ka: "თაფლის თვალი",
  title_en: "Honey Eye",
};

describe("owner draft preview repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { user: { id: "owner" } } }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it("does not query draft data without an active session", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(loadOwnerDraftPreview("taflis-tvali")).resolves.toEqual({ status: "login-required" });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("denies a signed-in non-owner before querying draft data", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(loadOwnerDraftPreview("taflis-tvali")).resolves.toEqual({ status: "access-denied" });
    expect(from).not.toHaveBeenCalled();
  });

  it("loads only a draft after the owner check", async () => {
    const filters: Array<[string, string]> = [];
    from.mockImplementation((table: string) => ({
      select: (columns: string) => {
        if (table === "songs" && columns.includes("title_ka")) {
          const chain = {
            eq: (column: string, value: string) => { filters.push([column, value]); return chain; },
            maybeSingle: async () => ({ data: row, error: null }),
          };
          return chain;
        }
        if (table === "song_files") return { in: () => ({ order: async () => ({ data: [], error: null }) }) };
        return { in: async () => ({ data: [{ id: row.id, learning_enabled: true, learning_instruments: ["piano", "guitar"], learning_source_type: "musicxml" }], error: null }) };
      },
    }));

    const result = await loadOwnerDraftPreview("taflis-tvali");

    expect(result.status).toBe("authenticated");
    expect(filters).toEqual([["slug", "taflis-tvali"], ["status", "draft"]]);
    expect(rpc).toHaveBeenCalledWith("is_admin");
  });
});
