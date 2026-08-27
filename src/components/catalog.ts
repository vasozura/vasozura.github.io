import type { Language } from "../i18n";
import type { Song } from "../types/song";
import { renderSongCard } from "./song-card";
import { escapeHtml } from "../utils/escape-html";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderCatalog(songs: Song[], language: Language): string {
  const heading = language === "ka" ? "მუსიკა" : "Music";
  const allReleases = language === "ka" ? "ყველა ჩანაწერი" : "All releases";
  const catalogLabel = language === "ka" ? "რჩეული ჩანაწერები" : "Selected releases";
  const labels = language === "ka"
    ? { search: "ძებნა", searchPlaceholder: "სათაური, ავტორი ან პოეტი", language: "ენა", lyricist: "პოეტი / ტექსტის ავტორი", difficulty: "სირთულე", resource: "რესურსი", all: "ყველა", audio: "MP3 აუდიო", midi: "MIDI", score: "MusicXML", pdf: "PDF ნოტები", lyrics: "ტექსტი", reset: "ფილტრების გასუფთავება", count: "ნაპოვნია" }
    : { search: "Search", searchPlaceholder: "Title, credit, composer or poet", language: "Language", lyricist: "Poet / lyricist", difficulty: "Difficulty", resource: "Resource", all: "All", audio: "MP3 audio", midi: "MIDI", score: "MusicXML", pdf: "PDF score", lyrics: "Lyrics", reset: "Clear filters", count: "Showing" };
  const languages = [...new Set(songs.map((song) => song.language).filter((value): value is string => Boolean(value)))].sort();
  const lyricists = [...new Set(songs.flatMap((song) => [song.lyricistOrPoet?.ka, song.lyricistOrPoet?.en]).filter((value): value is string => Boolean(value)))].sort();

  return `
    <section class="music shell" id="music" aria-labelledby="music-title">
      <div class="section-head">
        <span class="num">01 · SELECTED SOUND</span>
        <h2 id="music-title">${heading}</h2>
        <a class="all-releases" href="${channelUrl}" target="_blank" rel="noopener noreferrer">${allReleases} <span aria-hidden="true">↗</span></a>
      </div>
      <form class="catalog-filters" id="catalog-filters" role="search">
        <label class="filter-search"><span>${labels.search}</span><input id="catalog-search" type="search" placeholder="${labels.searchPlaceholder}" autocomplete="off" /></label>
        <label><span>${labels.language}</span><select id="catalog-language"><option value="">${labels.all}</option>${languages.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
        <label><span>${labels.lyricist}</span><select id="catalog-lyricist"><option value="">${labels.all}</option>${lyricists.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
        <label><span>${labels.difficulty}</span><select id="catalog-difficulty"><option value="">${labels.all}</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label><span>${labels.resource}</span><select id="catalog-resource"><option value="">${labels.all}</option><option value="audio">${labels.audio}</option><option value="midi">${labels.midi}</option><option value="musicxml">${labels.score}</option><option value="score">${labels.pdf}</option><option value="lyrics">${labels.lyrics}</option></select></label>
        <button class="filter-reset" type="reset">${labels.reset}</button>
      </form>
      <p class="catalog-count" id="catalog-count" aria-live="polite">${labels.count} ${songs.length}</p>
      <div class="release-list" id="release-list" aria-label="${catalogLabel}">
        ${songs.map((song, index) => renderSongCard(song, index, language)).join("")}
      </div>
      <p class="catalog-foundation">
        ${language === "ka"
          ? `${songs.length} ჩანაწერი · კატალოგის მონაცემებზე დაფუძნებული საწყისი სტრუქტურა`
          : `${songs.length} releases · a data-driven foundation for the growing catalog`}
      </p>
    </section>
  `;
}
