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
  /** Published slug -> Spotify release URL (DistroKid releases). */
  spotify: Record<string, string>;
  /** Published slug -> Apple Music / iTunes release URL. */
  apple: Record<string, string>;
  /** Published slug -> Spotify cover image id (the part after the size prefix). */
  covers: Record<string, string>;
  /** Published slug -> cover art hosted with the site (/covers/<slug>.webp). */
  artwork: Record<string, string>;
}

export const portfolioDataUrl = "/data/portfolio.json";

const emptyPortfolio: Portfolio = { generated: "", featured: null, order: {}, hidden: [], videos: [], spotify: {}, apple: {}, covers: {}, artwork: {} };

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
  const spotify: Record<string, string> = {};
  if (raw.spotify && typeof raw.spotify === "object") {
    for (const [slug, url] of Object.entries(raw.spotify as Record<string, unknown>)) {
      if (typeof url === "string" && /^https:\/\/open\.spotify\.com\/(album|track)\/[A-Za-z0-9]+$/.test(url)) spotify[slug] = url;
    }
  }
  const apple: Record<string, string> = {};
  if (raw.apple && typeof raw.apple === "object") {
    for (const [slug, url] of Object.entries(raw.apple as Record<string, unknown>)) {
      if (typeof url === "string" && /^https:\/\/music\.apple\.com\/album\/\d+$/.test(url)) apple[slug] = url;
    }
  }
  const covers: Record<string, string> = {};
  if (raw.covers && typeof raw.covers === "object") {
    for (const [slug, id] of Object.entries(raw.covers as Record<string, unknown>)) {
      if (typeof id === "string" && /^[0-9a-f]{24,64}$/.test(id)) covers[slug] = id;
    }
  }
  const artwork: Record<string, string> = {};
  if (raw.artwork && typeof raw.artwork === "object") {
    for (const [slug, path] of Object.entries(raw.artwork as Record<string, unknown>)) {
      if (typeof path === "string" && /^\/covers\/[a-z0-9-]+\.webp$/.test(path)) artwork[slug] = path;
    }
  }
  const featured = typeof raw.featured === "string" && youtubeIdPattern.test(raw.featured) ? raw.featured : null;
  return { generated: typeof raw.generated === "string" ? raw.generated : "", featured, order, hidden, videos, spotify, apple, covers, artwork };
}

let cached: Promise<Portfolio> | null = null;
let loaded: Portfolio = emptyPortfolio;

export function loadPortfolio(): Promise<Portfolio> {
  // no-cache: revalidate with the server so weekly data updates show up at once.
  cached ??= fetch(portfolioDataUrl, { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then(parsePortfolio)
    .catch(() => emptyPortfolio)
    .then((portfolio) => { loaded = portfolio; return portfolio; });
  return cached;
}

/** Spotify release for a published song, once the portfolio data has loaded. */
export function spotifyUrlFor(slug: string): string | null {
  return loaded.spotify[slug] ?? null;
}

/** Apple Music release for a published song, once the portfolio data has loaded. */
export function appleMusicUrlFor(slug: string): string | null {
  return loaded.apple[slug] ?? null;
}

/** Release artwork (Spotify CDN) for a song without its own cover: 300 px for cards, 640 px for the song page. */
export function releaseCoverFor(slug: string, size: "small" | "large" = "small"): string | null {
  const id = loaded.covers[slug];
  if (!id) return loaded.artwork[slug] ?? null;
  return `https://i.scdn.co/image/ab67616d${size === "large" ? "0000b273" : "00001e02"}${id}`;
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
