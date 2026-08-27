import type { Song } from "../types/song";
import { assertSongCollection } from "./song-validation";
import { loadPublishedSongsFromSupabase } from "./song-repository";

const demoDataUrl = "/data/demo-songs.json";

export async function loadSongs(): Promise<Song[]> {
  try {
    const remoteSongs = await loadPublishedSongsFromSupabase();
    if (remoteSongs) return remoteSongs;
  } catch (error) {
    console.warn("Supabase catalog is unavailable; using the verified local releases.", error);
  }
  const response = await fetch(demoDataUrl);
  if (!response.ok) {
    throw new Error(`Unable to load song data (${response.status}).`);
  }

  const data: unknown = await response.json();
  assertSongCollection(data);
  return data;
}
