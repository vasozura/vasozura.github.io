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

describe("streaming links", () => {
  it("keeps only Spotify and Apple Music release URLs", () => {
    const parsed = parsePortfolio({
      spotify: { a: "https://open.spotify.com/album/0R2fVwsvO3yd82bwIcCNvt", b: "javascript:alert(1)" },
      apple: { a: "https://music.apple.com/album/6835475181", b: "https://evil.example/album/1" },
    });
    expect(parsed.spotify).toEqual({ a: "https://open.spotify.com/album/0R2fVwsvO3yd82bwIcCNvt" });
    expect(parsed.apple).toEqual({ a: "https://music.apple.com/album/6835475181" });
  });
});

describe("release covers", () => {
  it("accepts only hex Spotify image ids", () => {
    const parsed = parsePortfolio({ covers: { a: "a3f8bb68b492f09f9d96d03d", b: "../../evil" } });
    expect(parsed.covers).toEqual({ a: "a3f8bb68b492f09f9d96d03d" });
  });
});
