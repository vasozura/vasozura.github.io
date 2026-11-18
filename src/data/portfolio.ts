// Portfolio data generated from the owner's local song library (see
// public/data/portfolio.json). It decides two things the database does not
// know: when each song was written (newest first) and which published rows are
// duplicate takes of a song that is already listed.

export interface PortfolioVideo {
  id: string;
  title: string;
  titleEn: string | null;
  poet: string;
  written: string | null;
  views: number;
  channel: string;
  slug: string | null;
}

export interface Portfolio {
  generated: string;
  featured: string | null;
  /** Canonical published slug -> ISO date (YYYY-MM-DD) the song was written. */
  order: Record<string, string | null>;
  /** Published slugs that duplicate a canonical song and stay off the public list. */
  hidden: string[];
  videos: PortfolioVideo[];
}

export const portfolioDataUrl = "/data/portfolio.json";

const emptyPortfolio: Portfolio = { generated: "", featured: null, order: {}, hidden: [], videos: [] };

const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function parsePortfolio(value: unknown): Portfolio {
  if (!value || typeof value !== "object") return emptyPortfolio;
  const raw = value as Record<string, unknown>;
  const order: Record<string, string | null> = {};
  if (raw.order && typeof raw.order === "object") {
    for (const [slug, date] of Object.entries(raw.order as Record<string, unknown>)) {
      order[slug] = typeof date === "string" ? date : null;
    }
  }
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((slug): slug is string => typeof slug === "string") : [];
  const videos = Array.isArray(raw.videos)
    ? raw.videos.flatMap((entry): PortfolioVideo[] => {
      if (!entry || typeof entry !== "object") return [];
      const video = entry as Record<string, unknown>;
      if (typeof video.id !== "string" || !youtubeIdPattern.test(video.id) || typeof video.title !== "string") return [];
      return [{
        id: video.id,
        title: video.title,
        titleEn: typeof video.titleEn === "string" ? video.titleEn : null,
        poet: typeof video.poet === "string" ? video.poet : "",
        written: typeof video.written === "string" ? video.written : null,
        views: typeof video.views === "number" ? video.views : 0,
        channel: typeof video.channel === "string" ? video.channel : "",
        slug: typeof video.slug === "string" ? video.slug : null,
      }];
    })
    : [];
  const featured = typeof raw.featured === "string" && youtubeIdPattern.test(raw.featured) ? raw.featured : null;
  return { generated: typeof raw.generated === "string" ? raw.generated : "", featured, order, hidden, videos };
}

let cached: Promise<Portfolio> | null = null;

export function loadPortfolio(): Promise<Portfolio> {
  cached ??= fetch(portfolioDataUrl)
    .then((response) => (response.ok ? response.json() : null))
    .then(parsePortfolio)
    .catch(() => emptyPortfolio);
  return cached;
}

export interface OrderableRow {
  id: string;
  slug: string;
  created_at?: string | null;
}

/**
 * Drops duplicate takes and orders rows newest-written first. Rows the
 * portfolio does not know about fall back to the date they were added.
 */
export function orderForPortfolio<T extends OrderableRow>(rows: T[], portfolio: Portfolio): T[] {
  const hidden = new Set(portfolio.hidden);
  const dateOf = (row: T): string => portfolio.order[row.slug] ?? (row.created_at ?? "").slice(0, 10);
  return rows
    .filter((row) => !hidden.has(row.slug))
    .map((row, index) => ({ row, index, date: dateOf(row) }))
    .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date < b.date ? 1 : -1))
    .map(({ row }) => row);
}
