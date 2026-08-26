import type { Song } from "../types/song";

export interface ValidationIssue {
  path: string;
  message: string;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const publicationStatuses = new Set(["draft", "published", "archived", null]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLocalizedTitle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.ka === "string" && value.ka.trim().length > 0 &&
    typeof value.en === "string" && value.en.trim().length > 0;
}

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1) || null;
    if (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com") {
      return parsed.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

export function validateSongCollection(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(value)) {
    return [{ path: "songs", message: "Song data must be an array." }];
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const videoIds = new Set<string>();

  value.forEach((entry, index) => {
    const path = `songs[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: "Song must be an object." });
      return;
    }

    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      issues.push({ path: `${path}.id`, message: "A non-empty id is required." });
    } else if (ids.has(entry.id)) {
      issues.push({ path: `${path}.id`, message: "Song ids must be unique." });
    } else {
      ids.add(entry.id);
    }

    if (typeof entry.slug !== "string" || !slugPattern.test(entry.slug)) {
      issues.push({ path: `${path}.slug`, message: "Slug must contain lowercase letters, numbers, and hyphens only." });
    } else if (slugs.has(entry.slug)) {
      issues.push({ path: `${path}.slug`, message: "Song slugs must be unique." });
    } else {
      slugs.add(entry.slug);
    }

    if (!hasLocalizedTitle(entry.title)) {
      issues.push({ path: `${path}.title`, message: "Verified Georgian and English titles are required." });
    }

    if (!publicationStatuses.has(entry.publicationStatus as string | null)) {
      issues.push({ path: `${path}.publicationStatus`, message: "Publication status is not supported." });
    }

    if (entry.youtubeUrl !== null || entry.youtubeVideoId !== null) {
      if (typeof entry.youtubeUrl !== "string" || typeof entry.youtubeVideoId !== "string") {
        issues.push({ path: `${path}.youtubeUrl`, message: "YouTube URL and video id must be supplied together." });
      } else {
        const extractedId = extractYouTubeId(entry.youtubeUrl);
        if (!videoIdPattern.test(entry.youtubeVideoId) || extractedId !== entry.youtubeVideoId) {
          issues.push({ path: `${path}.youtubeVideoId`, message: "YouTube URL and video id do not match." });
        } else if (videoIds.has(entry.youtubeVideoId)) {
          issues.push({ path: `${path}.youtubeVideoId`, message: "YouTube video ids must be unique." });
        } else {
          videoIds.add(entry.youtubeVideoId);
        }
      }
    }

    for (const numericField of ["durationSeconds", "bpm"] as const) {
      const fieldValue = entry[numericField];
      if (fieldValue !== null && (typeof fieldValue !== "number" || fieldValue <= 0)) {
        issues.push({ path: `${path}.${numericField}`, message: "Value must be null or a positive number." });
      }
    }
  });

  return issues;
}

export function assertSongCollection(value: unknown): asserts value is Song[] {
  const issues = validateSongCollection(value);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }
}
