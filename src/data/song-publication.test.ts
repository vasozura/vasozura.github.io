import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  getSupabase: () => null,
  requireSupabase: () => ({ rpc }),
}));

import { setSongStatus } from "./song-repository";

describe("atomic song publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [{ song_status: "published" }], error: null });
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
});
