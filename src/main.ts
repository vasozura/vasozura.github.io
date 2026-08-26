import "./styles.css";
import { renderFooter } from "./components/footer";
import { renderHeader } from "./components/header";
import { renderHome } from "./components/home";
import { renderPlayerShell } from "./components/player-shell";
import { renderSongDetail, renderSongNotFound } from "./components/song-detail";
import { loadSongs } from "./data/load-songs";
import { getInitialLanguage, storeLanguage, type Language } from "./i18n";
import { parseRoute } from "./router";
import type { Song } from "./types/song";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("The application root was not found.");
const app: HTMLDivElement = appElement;

let language: Language = getInitialLanguage();
let songs: Song[] = [];
let lastRenderedHash = "";

const descriptions: Record<Language, string> = {
  ka: "ZURA-ს ოფიციალური მუსიკალური სივრცე — რჩეული ჩანაწერები და ორენოვანი კომპოზიტორის არქივის საფუძველი.",
  en: "The official music space of ZURA — selected releases and the foundation of a bilingual composer archive.",
};

function updateDocumentMetadata(song?: Song): void {
  document.documentElement.lang = language;
  const title = song?.title[language] ?? song?.title.ka ?? song?.title.en;
  document.title = title ? `${title} — ZURA Music` : "ZURA Music — Composer Archive";
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", descriptions[language]);
}

function bindInteractions(): void {
  document.querySelector<HTMLButtonElement>("#language-toggle")?.addEventListener("click", () => {
    language = language === "ka" ? "en" : "ka";
    storeLanguage(language);
    render();
  });
}

function scrollToHomeAnchor(anchor: string | null): void {
  if (!anchor) return;
  window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
}

function render(): void {
  const route = parseRoute(window.location.hash);
  const routeChanged = lastRenderedHash !== window.location.hash;
  const selectedSong = route.name === "song" ? songs.find((song) => song.slug === route.slug) : undefined;
  updateDocumentMetadata(selectedSong);

  const skipLabel = language === "ka" ? "მთავარ შინაარსზე გადასვლა" : "Skip to main content";
  const content = route.name === "song"
    ? selectedSong
      ? renderSongDetail(selectedSong, language)
      : renderSongNotFound(language)
    : renderHome(songs, language);

  app.innerHTML = `
    <a class="skip-link" href="#main-content">${skipLabel}</a>
    ${renderHeader(language)}
    ${content}
    ${renderPlayerShell(language)}
    ${renderFooter(language)}
  `;

  bindInteractions();
  if (route.name === "home") {
    scrollToHomeAnchor(route.anchor);
  } else if (routeChanged) {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }
  lastRenderedHash = window.location.hash;
}

function renderLoadError(error: unknown): void {
  const message = language === "ka"
    ? "კატალოგის მონაცემები ვერ ჩაიტვირთა."
    : "The catalog data could not be loaded.";
  console.error(error);
  updateDocumentMetadata();
  app.innerHTML = `
    <a class="skip-link" href="#main-content">${language === "ka" ? "მთავარ შინაარსზე გადასვლა" : "Skip to main content"}</a>
    ${renderHeader(language)}
    <main class="route-message shell" id="main-content" tabindex="-1">
      <p class="num">DATA · ERROR</p>
      <h1>${message}</h1>
    </main>
    ${renderFooter(language)}
  `;
  bindInteractions();
}

window.addEventListener("hashchange", render);

loadSongs()
  .then((loadedSongs) => {
    songs = loadedSongs;
    render();
  })
  .catch(renderLoadError);
