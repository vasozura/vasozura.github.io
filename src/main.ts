import "./styles.css";
import { renderFooter } from "./components/footer";
import { renderHeader } from "./components/header";
import { renderHome } from "./components/home";
import { renderPlayerShell } from "./components/player-shell";
import { renderSongCard } from "./components/song-card";
import { mountAdmin } from "./components/admin";
import { renderSongDetail, renderSongNotFound } from "./components/song-detail";
import { loadSongs } from "./data/load-songs";
import { getInitialLanguage, storeLanguage, type Language } from "./i18n";
import { parseRoute } from "./router";
import type { Song } from "./types/song";
import { filterSongs } from "./utils/catalog-filter";
import type { SongFilters } from "./types/song";
import { PlayerController } from "./player/player-controller";
import { mountScoreViewer } from "./score/score-viewer";
import { isPasswordRecovery } from "./lib/supabase";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("The application root was not found.");
const app: HTMLDivElement = appElement;

let language: Language = getInitialLanguage();
let songs: Song[] = [];
let lastRenderedHash = "";
const player = new PlayerController();

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
  bindCatalogFilters();
  player.bind(app, songs, language);
  const score = document.querySelector<HTMLElement>("#interactive-score");
  if (score) void mountScoreViewer(score);
}

function readCatalogFilters(): SongFilters {
  return {
    query: document.querySelector<HTMLInputElement>("#catalog-search")?.value ?? "",
    language: document.querySelector<HTMLSelectElement>("#catalog-language")?.value ?? "",
    lyricist: document.querySelector<HTMLSelectElement>("#catalog-lyricist")?.value ?? "",
    difficulty: document.querySelector<HTMLSelectElement>("#catalog-difficulty")?.value ?? "",
    resource: (document.querySelector<HTMLSelectElement>("#catalog-resource")?.value ?? "") as SongFilters["resource"],
  };
}

function bindCatalogFilters(): void {
  const form = document.querySelector<HTMLFormElement>("#catalog-filters");
  const list = document.querySelector<HTMLElement>("#release-list");
  const count = document.querySelector<HTMLElement>("#catalog-count");
  if (!form || !list || !count) return;
  const apply = (): void => {
    const filtered = filterSongs(songs, readCatalogFilters());
    list.innerHTML = filtered.map((song, index) => renderSongCard(song, index, language)).join("");
    count.textContent = `${language === "ka" ? "ნაპოვნია" : "Showing"} ${filtered.length}`;
    if (!filtered.length) list.innerHTML = `<p class="catalog-empty">${language === "ka" ? "ამ ფილტრებით ჩანაწერი ვერ მოიძებნა." : "No releases match these filters."}</p>`;
    player.bind(app, songs, language);
  };
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
  form.addEventListener("reset", () => window.setTimeout(apply, 0));
}

function scrollToHomeAnchor(anchor: string | null): void {
  if (!anchor) return;
  window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
}

function render(): void {
  const route = isPasswordRecovery() ? { name: "admin" as const } : parseRoute(window.location.hash);
  const routeChanged = lastRenderedHash !== window.location.hash;
  if (route.name === "admin") {
    updateDocumentMetadata();
    document.title = "Archive administration — ZURA Music";
    app.innerHTML = `<main class="admin-route shell" id="main-content"><p class="num">OWNER ARCHIVE</p><p>Loading administration…</p></main>`;
    void mountAdmin(app).catch((error: unknown) => {
      console.error(error);
      app.innerHTML = `<main class="admin-route shell" id="main-content"><p class="num">ADMIN · ERROR</p><h1>The administration area could not be loaded.</h1><p>${error instanceof Error ? error.message : "Unknown error"}</p><a href="#top">Return to site</a></main>`;
    });
    if (routeChanged) window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    lastRenderedHash = window.location.hash;
    return;
  }
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
    ${renderPlayerShell(language, songs)}
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
