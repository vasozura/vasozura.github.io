import type { Language } from "../i18n";
import type { Song } from "../types/song";
import { renderCatalog } from "./catalog";
import { renderContact } from "./contact";
import { renderHero } from "./hero";
import { renderStory } from "./story";
import { renderTicker } from "./ticker";
import { renderServices } from "./services";
import { renderVideos } from "./videos";
import type { Portfolio } from "../data/portfolio";

export function renderHome(songs: Song[], language: Language, portfolio: Portfolio | null = null): string {
  return `
    <main id="main-content" tabindex="-1">
      ${renderHero(language, songs.length)}
      ${renderTicker()}
      ${renderVideos(portfolio, language)}
      ${renderCatalog(songs, language)}
      ${renderServices(language)}
      ${renderStory(language)}
      ${renderContact(language)}
    </main>
  `;
}
