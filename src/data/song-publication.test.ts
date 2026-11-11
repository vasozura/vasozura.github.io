import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => null,
  requireSupabase: () => ({ rpc, from }),
}));

import { setSongStatus } from "./song-repository";

describe("atomic song publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [{ song_status: "published" }], error: null });
    eq.mockResolvedValue({ error: null });
  });

  it("publishes through the owner-only archive and Learning RPC", async () => {
    await setSongStatus("7037edfc-52ef-4ba2-a031-bbfccde66ac3", "published");

    expect(rpc).toHaveBeenCalledWith("set_song_publication_with_learning", {
      p_song_id: "7037edfc-52ef-4ba2-a031-bbfccde66ac3",
      p_status: "published",
    });
  });

  it("uses the same transaction for unpublication", async () => {
    await setSongStatus("7037edfc-52ef-4ba2-a031-bbfccde66ac3", "draft");

    expect(rpc).toHaveBeenCalledWith("set_song_publication_with_learning", {
      p_song_id: "7037edfc-52ef-4ba2-a031-bbfccde66ac3",
      p_status: "draft",
    });
  });

  it("fails closed when the database transaction rejects publication", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("manifest mismatch") });

    await expect(setSongStatus("7037edfc-52ef-4ba2-a031-bbfccde66ac3", "published")).rejects.toThrow("manifest mismatch");
  });

  it("falls back to admin RLS updates when production is missing the RPC", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "function is not in the schema cache" } });

    await setSongStatus("7037edfc-52ef-4ba2-a031-bbfccde66ac3", "published");

    expect(from).toHaveBeenNthCalledWith(1, "songs");
    expect(from).toHaveBeenNthCalledWith(2, "learning_exercises");
    expect(update).toHaveBeenNthCalledWith(2, { is_public: true });
  });
});
