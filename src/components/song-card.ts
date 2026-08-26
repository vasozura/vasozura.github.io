import { localize, type Language } from "../i18n";
import type { Song } from "../types/song";
import { escapeHtml } from "../utils/escape-html";

export function renderSongCard(song: Song, index: number, language: Language): string {
  const title = escapeHtml(localize(song.title, language) ?? song.id);
  const credit = escapeHtml(localize(song.displayCredit, language) ?? "ZURA");
  const number = String(index + 1).padStart(2, "0");
  const detailsLabel = language === "ka" ? `${title} — დეტალები` : `${title} — details`;
  const youtubeLabel = language === "ka" ? `${title} — YouTube-ზე მოსმენა` : `Listen to ${title} on YouTube`;
  const cover = song.coverUrl
    ? `<img src="${escapeHtml(song.coverUrl)}" alt="${title}" width="76" height="76" loading="lazy" decoding="async" />`
    : `<i aria-hidden="true">ZV</i>`;
  const youtube = song.youtubeUrl
    ? `<a class="round" href="${escapeHtml(song.youtubeUrl)}" aria-label="${youtubeLabel}"><span aria-hidden="true">▶</span></a>`
    : `<span class="round round-disabled" aria-hidden="true">—</span>`;

  return `
    <article class="release-card">
      <span class="release-number" aria-hidden="true">${number}</span>
      <span class="cover">${cover}</span>
      <a class="release-title" href="#/song/${escapeHtml(song.slug)}" aria-label="${detailsLabel}">
        <small>${credit}</small>
        <strong>${title}</strong>
      </a>
      ${youtube}
    </article>
  `;
}
