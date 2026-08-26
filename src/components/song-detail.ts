import { localize, type Language } from "../i18n";
import type { LocalizedText, Song } from "../types/song";
import { escapeHtml } from "../utils/escape-html";

interface DetailRow {
  label: string;
  value: string | number | null;
}

function localizedRow(label: string, value: LocalizedText | null, language: Language): DetailRow {
  return { label, value: localize(value, language) };
}

export function renderSongDetail(song: Song, language: Language): string {
  const title = escapeHtml(localize(song.title, language) ?? song.id);
  const credit = localize(song.displayCredit, language);
  const labels = language === "ka"
    ? {
        back: "კატალოგში დაბრუნება",
        composer: "კომპოზიტორი",
        poet: "ტექსტი / პოეტი",
        translator: "მთარგმნელი",
        language: "ენა",
        duration: "ხანგრძლივობა",
        bpm: "BPM",
        key: "ტონალობა",
        signature: "ზომა",
        difficulty: "სირთულე",
        youtube: "YouTube-ზე მოსმენა",
        unavailable: "ამ ეტაპზე აუდიო, ნოტები და ტექსტი დამატებული არ არის.",
      }
    : {
        back: "Back to catalog",
        composer: "Composer",
        poet: "Lyrics / poet",
        translator: "Translator",
        language: "Language",
        duration: "Duration",
        bpm: "BPM",
        key: "Key",
        signature: "Time signature",
        difficulty: "Difficulty",
        youtube: "Listen on YouTube",
        unavailable: "Audio, score files and lyrics are not available in this phase.",
      };

  const rows: DetailRow[] = [
    localizedRow(labels.composer, song.composer, language),
    localizedRow(labels.poet, song.lyricistOrPoet, language),
    localizedRow(labels.translator, song.translator, language),
    { label: labels.language, value: song.language },
    { label: labels.duration, value: song.durationSeconds },
    { label: labels.bpm, value: song.bpm },
    { label: labels.key, value: song.musicalKey },
    { label: labels.signature, value: song.timeSignature },
    { label: labels.difficulty, value: song.difficulty },
  ].filter((row) => row.value !== null && row.value !== "");

  const metadata = rows.length > 0
    ? `<dl class="song-metadata">${rows.map((row) => `
        <div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(String(row.value))}</dd></div>
      `).join("")}</dl>`
    : "";
  const description = localize(song.description, language);
  const cover = song.coverUrl
    ? `<img src="${escapeHtml(song.coverUrl)}" alt="${title}" width="520" height="520" />`
    : `<span aria-hidden="true">ZV</span>`;
  const youtube = song.youtubeUrl
    ? `<a class="detail-youtube" href="${escapeHtml(song.youtubeUrl)}"><span aria-hidden="true">▶</span>${labels.youtube}</a>`
    : "";

  return `
    <main class="song-detail shell" id="main-content" tabindex="-1">
      <a class="detail-back" href="#music"><span aria-hidden="true">←</span> ${labels.back}</a>
      <article class="song-detail-grid">
        <div class="detail-cover">${cover}</div>
        <div class="detail-copy">
          <p class="num">SONG ARCHIVE · ${escapeHtml(song.id.toUpperCase())}</p>
          <h1>${title}</h1>
          ${credit ? `<p class="detail-credit">${escapeHtml(credit)}</p>` : ""}
          ${description ? `<p class="detail-description">${escapeHtml(description)}</p>` : ""}
          ${metadata}
          ${youtube}
          <p class="detail-unavailable">${labels.unavailable}</p>
        </div>
      </article>
    </main>
  `;
}

export function renderSongNotFound(language: Language): string {
  return `
    <main class="song-detail shell" id="main-content" tabindex="-1">
      <a class="detail-back" href="#music"><span aria-hidden="true">←</span> ${language === "ka" ? "კატალოგში დაბრუნება" : "Back to catalog"}</a>
      <div class="route-message">
        <p class="num">404 · SONG ARCHIVE</p>
        <h1>${language === "ka" ? "ჩანაწერი ვერ მოიძებნა." : "Song not found."}</h1>
      </div>
    </main>
  `;
}
