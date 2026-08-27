export type Route =
  | { name: "home"; anchor: string | null }
  | { name: "song"; slug: string }
  | { name: "admin" };

export function parseRoute(hash: string): Route {
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
