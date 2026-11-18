import { describe, expect, it } from "vitest";
import { orderForPortfolio, parsePortfolio } from "./portfolio";

describe("portfolio ordering", () => {
  const portfolio = parsePortfolio({
    featured: "1aWyT1B7YF4",
    order: { "new-song": "2026-11-12", "old-song": "2025-01-01" },
    hidden: ["old-song-take-2"],
    videos: [{ id: "bad", title: "x" }, { id: "1aWyT1B7YF4", title: "Hit", views: 170000 }],
  });

  it("hides duplicate takes and puts the newest-written song first", () => {
    const rows = [
      { id: "1", slug: "old-song", created_at: "2026-09-01T00:00:00Z" },
      { id: "2", slug: "old-song-take-2", created_at: "2026-09-02T00:00:00Z" },
      { id: "3", slug: "unknown", created_at: "2026-10-01T00:00:00Z" },
      { id: "4", slug: "new-song", created_at: "2026-08-01T00:00:00Z" },
    ];
    expect(orderForPortfolio(rows, portfolio).map((row) => row.slug)).toEqual(["new-song", "unknown", "old-song"]);
  });

  it("drops videos without a valid YouTube id", () => {
    expect(portfolio.videos.map((video) => video.id)).toEqual(["1aWyT1B7YF4"]);
  });
});
