const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeVideoId(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let candidate: string | null = null;
    if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") candidate = url.searchParams.get("v");
      else if (/^\/(embed|shorts|live)\//.test(url.pathname)) candidate = url.pathname.split("/")[2] ?? null;
    }
    return candidate && videoIdPattern.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function youtubePrivacyEmbedUrl(videoId: string): string {
  if (!videoIdPattern.test(videoId)) throw new Error("Invalid YouTube video id.");
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
}
