import type { Song, SongFilters } from "../types/song";

function normalize(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function filterSongs(songs: Song[], filters: SongFilters): Song[] {
  const query = normalize(filters.query);
  const lyricist = normalize(filters.lyricist);
  return songs.filter((song) => {
    const searchable = [song.title.ka, song.title.en, song.displayCredit?.ka, song.displayCredit?.en, song.composer?.ka, song.composer?.en, song.lyricistOrPoet?.ka, song.lyricistOrPoet?.en].map(normalize).join(" ");
    if (query && !searchable.includes(query)) return false;
    if (filters.language && normalize(song.language) !== normalize(filters.language)) return false;
    if (lyricist && ![song.lyricistOrPoet?.ka, song.lyricistOrPoet?.en].map(normalize).some((value) => value.includes(lyricist))) return false;
    if (filters.difficulty && song.difficulty !== filters.difficulty) return false;
    if (filters.resource === "audio" && !song.audioUrl) return false;
    if (filters.resource === "midi" && !song.midiUrl) return false;
    if (filters.resource === "musicxml" && !song.musicXmlUrl) return false;
    if (filters.resource === "score" && !song.scorePdfUrl) return false;
    if (filters.resource === "lyrics" && !song.lyrics?.ka && !song.lyrics?.en) return false;
    return true;
  });
}

export const emptySongFilters: SongFilters = { query: "", language: "", lyricist: "", difficulty: "", resource: "" };
