import type { Language } from "../i18n";
import type { Song } from "../types/song";
import { renderCatalog } from "./catalog";
import { renderContact } from "./contact";
import { renderHero } from "./hero";
import { renderStory } from "./story";
import { renderTicker } from "./ticker";

export function renderHome(songs: Song[], language: Language): string {
  return `
    <main id="main-content" tabindex="-1">
      ${renderHero(language)}
      ${renderTicker()}
      ${renderCatalog(songs, language)}
      ${renderStory(language)}
      ${renderContact(language)}
    </main>
  `;
}
