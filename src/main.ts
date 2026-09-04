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
import { getSupabase, isPasswordRecovery } from "./lib/supabase";
import { loadOwnerDraftPreview, type DraftPreviewResult } from "./data/song-repository";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("The application root was not found.");
const app: HTMLDivElement = appElement;

let language: Language = getInitialLanguage();
let songs: Song[] = [];
let lastRenderedHash = "";
const player = new PlayerController();
let learningCleanup: (() => void) | null = null;
let draftPreview: { slug: string; result: DraftPreviewResult | null; error: string | null } | null = null;

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

function updateRobots(indexable: boolean): void {
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = indexable ? "index,follow" : "noindex,nofollow,noarchive";
}

function bindInteractions(playableSongs: Song[] = songs): void {
  document.querySelector<HTMLButtonElement>("#language-toggle")?.addEventListener("click", () => {
    language = language === "ka" ? "en" : "ka";
    storeLanguage(language);
    render();
  });
  bindCatalogFilters();
  player.bind(app, playableSongs, language);
  const score = document.querySelector<HTMLElement>("#interactive-score");
  const openLearning = score?.querySelector<HTMLButtonElement>("[data-open-learning]");
  if (score && openLearning) openLearning.addEventListener("click", async () => {
    if (score.dataset.mounted === "true") return;
    score.dataset.mounted = "true";
    openLearning.disabled = true;
    const status = score.querySelector<HTMLElement>(".score-status");
    if (status) status.textContent = "Loading interactive score…";
    try {
      const cleanup = score.dataset.learningEnabled === "true"
        ? await import("./learning/learning-mode").then(({ mountLearningMode }) => mountLearningMode(score))
        : await import("./score/score-viewer").then(({ mountScoreViewer }) => mountScoreViewer(score));
      if (score.isConnected) learningCleanup = cleanup;
      else cleanup();
    } catch (error) {
      score.dataset.mounted = "false";
      openLearning.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : "Learning could not be opened.";
    }
  });
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
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView()));
}

function scrollToRouteTop(): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo({ top: 0, behavior: "auto" });
    root.style.scrollBehavior = previousBehavior;
  }));
}

function render(): void {
  learningCleanup?.();
  learningCleanup = null;
  const route = isPasswordRecovery() ? { name: "admin" as const } : parseRoute(window.location.hash);
  const routeChanged = lastRenderedHash !== window.location.hash;
  if (route.name !== "admin-preview") draftPreview = null;
  if (route.name === "admin") {
    updateRobots(false);
    updateDocumentMetadata();
    document.title = "Archive administration — ZURA Music";
    app.innerHTML = `<main class="admin-route shell" id="main-content"><p class="num">OWNER ARCHIVE</p><p>Loading administration…</p></main>`;
    void mountAdmin(app).catch((error: unknown) => {
      console.error(error);
      app.innerHTML = `<main class="admin-route shell" id="main-content"><p class="num">ADMIN · ERROR</p><h1>The administration area could not be loaded.</h1><p>${error instanceof Error ? error.message : "Unknown error"}</p><a href="#top">Return to site</a></main>`;
    });
    if (routeChanged) scrollToRouteTop();
    lastRenderedHash = window.location.hash;
    return;
  }
  if (route.name === "admin-preview") {
    updateRobots(false);
    if (!draftPreview || draftPreview.slug !== route.slug) {
      draftPreview = { slug: route.slug, result: null, error: null };
      void loadOwnerDraftPreview(route.slug).then((result) => {
        if (draftPreview?.slug !== route.slug || parseRoute(window.location.hash).name !== "admin-preview") return;
        draftPreview.result = result;
        render();
      }).catch((error: unknown) => {
        if (draftPreview?.slug !== route.slug || parseRoute(window.location.hash).name !== "admin-preview") return;
        draftPreview.error = error instanceof Error ? error.message : "Unknown preview error";
        render();
      });
    }
    const result = draftPreview.result;
    const previewSong = result?.status === "authenticated" ? result.song : undefined;
    updateDocumentMetadata(previewSong);
    document.title = previewSong ? `${previewSong.title[language] ?? previewSong.slug} — Private draft preview` : "Private draft preview — ZURA Music";
    const skipLabel = language === "ka" ? "მთავარ შინაარსზე გადასვლა" : "Skip to main content";
    const message = draftPreview.error
      ? `<p class="num">PREVIEW · ERROR</p><h1>Preview unavailable</h1><p>The private draft could not be loaded.</p><a href="#/admin">Return to administration</a>`
      : !result
        ? `<p class="num">OWNER PREVIEW</p><h1>Loading private draft…</h1>`
        : result.status === "login-required"
          ? `<p class="num">OWNER PREVIEW · SIGN IN REQUIRED</p><h1>Private draft preview</h1><p>Sign in through archive administration to view this draft.</p><a href="#/admin">Owner sign in</a>`
          : result.status === "access-denied"
            ? `<p class="num">OWNER PREVIEW · ACCESS DENIED</p><h1>Private draft preview</h1><p>This account is not authorized to preview drafts.</p><a href="#/admin">Return to administration</a>`
            : `<p class="num">404 · PRIVATE DRAFT</p><h1>Draft not found</h1><a href="#/admin">Return to administration</a>`;
    const content = previewSong ? renderSongDetail(previewSong, language, { privateDraftPreview: true }) : `<main class="route-message shell" id="main-content" tabindex="-1">${message}</main>`;
    const playableSongs = previewSong ? [...songs, previewSong] : songs;
    app.innerHTML = `<a class="skip-link" href="#main-content">${skipLabel}</a>${renderHeader(language)}${content}${renderPlayerShell(language, playableSongs)}${renderFooter(language)}`;
    bindInteractions(playableSongs);
    if (routeChanged) scrollToRouteTop();
    lastRenderedHash = window.location.hash;
    return;
  }
  updateRobots(true);
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
    if (route.anchor) scrollToHomeAnchor(route.anchor);
    else if (routeChanged) scrollToRouteTop();
  } else if (routeChanged) {
    scrollToRouteTop();
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
getSupabase()?.auth.onAuthStateChange((event) => {
  if (event !== "SIGNED_OUT") return;
  draftPreview = null;
  if (parseRoute(window.location.hash).name === "admin-preview") render();
});

loadSongs()
  .then((loadedSongs) => {
    songs = loadedSongs;
    render();
  })
  .catch(renderLoadError);
