import type { Language } from "../i18n";
import type { Song } from "../types/song";
import { renderSongCard } from "./song-card";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderCatalog(songs: Song[], language: Language): string {
  const heading = language === "ka" ? "მუსიკა" : "Music";
  const allReleases = language === "ka" ? "ყველა ჩანაწერი" : "All releases";
  const catalogLabel = language === "ka" ? "რჩეული ჩანაწერები" : "Selected releases";

  return `
    <section class="music shell" id="music" aria-labelledby="music-title">
      <div class="section-head">
        <span class="num">01 · SELECTED SOUND</span>
        <h2 id="music-title">${heading}</h2>
        <a class="all-releases" href="${channelUrl}">${allReleases} <span aria-hidden="true">↗</span></a>
      </div>
      <div class="release-list" aria-label="${catalogLabel}">
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
