import type { Song } from "../types/song";
import { assertSongCollection } from "./song-validation";

const demoDataUrl = "/data/demo-songs.json";

export async function loadSongs(): Promise<Song[]> {
  const response = await fetch(demoDataUrl);
  if (!response.ok) {
    throw new Error(`Unable to load song data (${response.status}).`);
  }

  const data: unknown = await response.json();
  assertSongCollection(data);
  return data;
}
