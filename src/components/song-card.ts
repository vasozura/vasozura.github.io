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
    ? `<a class="round" href="${escapeHtml(song.youtubeUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${youtubeLabel}"><span aria-hidden="true">▶</span></a>`
    : `<span class="round round-disabled" aria-hidden="true">—</span>`;
  const play = song.audioUrl
    ? `<button class="card-play" type="button" data-play-song="${escapeHtml(song.id)}" aria-label="${language === "ka" ? `${title} — MP3 დაკვრა` : `Play ${title} MP3`}"><span aria-hidden="true">▶</span></button>`
    : "";
  const duration = song.durationSeconds
    ? `${Math.floor(song.durationSeconds / 60)}:${String(Math.round(song.durationSeconds % 60)).padStart(2, "0")}`
    : null;
  const facts = [song.language, duration, song.musicalKey, song.bpm ? `${song.bpm} BPM` : null].filter(Boolean);
  const resources = [song.audioUrl && "MP3", song.midiUrl && "MIDI", song.musicXmlUrl && "XML", song.scorePdfUrl && "PDF", song.lyrics && "TXT"].filter(Boolean);

  return `
    <article class="release-card">
      <span class="release-number" aria-hidden="true">${number}</span>
      <span class="cover">${cover}</span>
      <a class="release-title" href="#/song/${escapeHtml(song.slug)}" aria-label="${detailsLabel}">
        <small>${credit}</small>
        <strong>${title}</strong>
        <span class="release-facts">${facts.map((fact) => `<b>${escapeHtml(String(fact))}</b>`).join("")}</span>
      </a>
      <span class="release-resources" aria-label="${language === "ka" ? "ხელმისაწვდომი რესურსები" : "Available resources"}">${resources.map((resource) => `<i>${resource}</i>`).join("")}</span>
      ${play}
      ${youtube}
    </article>
  `;
}
