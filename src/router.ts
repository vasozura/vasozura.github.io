export type Route =
  | { name: "home"; anchor: string | null }
  | { name: "song"; slug: string }
  | { name: "admin-preview"; slug: string }
  | { name: "admin" };

export function parseRoute(hash: string): Route {
  const previewMatch = hash.match(/^#\/admin\/songs\/([^/?#]+)\/preview(?:[?#].*)?$/);
  if (previewMatch) {
    try {
      return { name: "admin-preview", slug: decodeURIComponent(previewMatch[1]) };
    } catch {
      return { name: "admin-preview", slug: "" };
    }
  }
  if (hash === "#/admin" || hash.startsWith("#/admin?")) return { name: "admin" };
  const songPrefix = "#/song/";
  if (hash.startsWith(songPrefix)) {
    const encodedSlug = hash.slice(songPrefix.length).split(/[?#]/, 1)[0];
    try {
      return { name: "song", slug: decodeURIComponent(encodedSlug) };
    } catch {
      return { name: "song", slug: "" };
    }
  }

  return { name: "home", anchor: hash.startsWith("#") ? hash.slice(1) || null : null };
}
