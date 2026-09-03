import { localize, type Language } from "../i18n";
import type { LocalizedText, Song } from "../types/song";
import { escapeHtml } from "../utils/escape-html";
import { youtubePrivacyEmbedUrl } from "../utils/youtube";

interface DetailRow { label: string; value: string | number | null; }

function localizedRow(label: string, value: LocalizedText | null, language: Language): DetailRow {
  return { label, value: localize(value, language) };
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface SongDetailOptions { privateDraftPreview?: boolean; }

export function renderSongDetail(song: Song, language: Language, options: SongDetailOptions = {}): string {
  const title = escapeHtml(localize(song.title, language) ?? song.id);
  const credit = localize(song.displayCredit, language);
  const lyrics = localize(song.lyrics, language);
  const labels = language === "ka"
    ? { back: "კატალოგში დაბრუნება", composer: "კომპოზიტორი", poet: "ტექსტი / პოეტი", translator: "მთარგმნელი", language: "ენა", duration: "ხანგრძლივობა", bpm: "BPM", key: "ტონალობა", signature: "ზომა", difficulty: "სირთულე", youtube: "YouTube", suno: "Suno წყარო", play: "გლობალურ ფლეერში დაკვრა", lyrics: "ტექსტი", audio: "MP3 აუდიო", resources: "რესურსები", midi: "MIDI ფაილი", score: "ინტერაქტიული ნოტები", pdf: "PDF ნოტები", source: "MuseScore წყარო", pdfPreview: "PDF-ის ნახვა", noResources: "ამ ჩანაწერის დამატებითი ფაილები ჯერ არ არის გამოქვეყნებული." }
    : { back: "Back to catalog", composer: "Composer", poet: "Lyrics / poet", translator: "Translator", language: "Language", duration: "Duration", bpm: "BPM", key: "Key", signature: "Time signature", difficulty: "Difficulty", youtube: "YouTube", suno: "Suno source", play: "Play in global player", lyrics: "Lyrics", audio: "MP3 audio", resources: "Resources", midi: "MIDI file", score: "Interactive score", pdf: "PDF score", source: "MuseScore source", pdfPreview: "View PDF", noResources: "No additional files are published for this song yet." };

  const rows: DetailRow[] = [
    localizedRow(labels.composer, song.composer, language),
    localizedRow(labels.poet, song.lyricistOrPoet, language),
    localizedRow(labels.translator, song.translator, language),
    { label: labels.language, value: song.language },
    { label: labels.duration, value: formatDuration(song.durationSeconds) },
    { label: labels.bpm, value: song.bpm },
    { label: labels.key, value: song.musicalKey },
    { label: labels.signature, value: song.timeSignature },
    { label: labels.difficulty, value: song.difficulty },
  ].filter((row) => row.value !== null && row.value !== "");

  const metadata = rows.length ? `<dl class="song-metadata">${rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(String(row.value))}</dd></div>`).join("")}</dl>` : "";
  const description = localize(song.description, language);
  const cover = song.coverUrl ? `<img src="${escapeHtml(song.coverUrl)}" alt="${title}" width="520" height="520" decoding="async" />` : `<span aria-hidden="true">ZV</span>`;
  const primaryLinks = [
    song.youtubeUrl ? `<a class="resource-link" href="${escapeHtml(song.youtubeUrl)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span>${labels.youtube}</a>` : "",
    song.sunoUrl ? `<a class="resource-link" href="${escapeHtml(song.sunoUrl)}" target="_blank" rel="noopener noreferrer">${labels.suno}<span aria-hidden="true">↗</span></a>` : "",
  ].filter(Boolean).join("");
  const resourceLinks = [
    song.midiUrl ? `<a class="resource-link" href="${escapeHtml(song.midiUrl)}" download>${labels.midi}</a>` : "",
    song.scorePdfUrl ? `<a class="resource-link" href="${escapeHtml(song.scorePdfUrl)}" target="_blank" rel="noopener noreferrer">${labels.pdf}</a>` : "",
    song.sourceProjectUrl ? `<a class="resource-link" href="${escapeHtml(song.sourceProjectUrl)}" download>${labels.source}</a>` : "",
  ].filter(Boolean).join("");

  return `
    <main class="song-detail shell" id="main-content" tabindex="-1">
      ${options.privateDraftPreview ? `<aside class="draft-preview-banner" role="status"><strong>${language === "ka" ? "პირადი მონახაზის წინასწარი ნახვა" : "Private draft preview"}</strong><span>${language === "ka" ? "ეს ჩანაწერი საჯაროდ არ ჩანს." : "This song is not publicly visible."}</span></aside>` : ""}
      <a class="detail-back" href="${options.privateDraftPreview ? "#/admin" : "#music"}"><span aria-hidden="true">←</span> ${options.privateDraftPreview ? (language === "ka" ? "ადმინისტრირებაში დაბრუნება" : "Back to administration") : labels.back}</a>
      <article class="song-detail-grid">
        <div class="detail-cover">${cover}</div>
        <div class="detail-copy">
          <p class="num">SONG ARCHIVE · ${escapeHtml(song.slug.toUpperCase())}</p>
          <h1>${title}</h1>
          ${credit ? `<p class="detail-credit">${escapeHtml(credit)}</p>` : ""}
          ${description ? `<p class="detail-description">${escapeHtml(description)}</p>` : ""}
          ${metadata}
          <div class="resource-links">${song.audioUrl ? `<button class="resource-link" type="button" data-play-song="${escapeHtml(song.id)}">♫ ${labels.play}</button>` : ""}${primaryLinks}</div>
        </div>
      </article>
      ${song.audioUrl ? `<section class="song-resource" aria-labelledby="audio-title"><h2 id="audio-title">${labels.audio}</h2><audio controls preload="metadata" src="${escapeHtml(song.audioUrl)}">${labels.audio}</audio></section>` : ""}
      ${lyrics ? `<section class="song-resource lyrics-panel" aria-labelledby="lyrics-title"><h2 id="lyrics-title">${labels.lyrics}</h2><p>${escapeHtml(lyrics)}</p></section>` : ""}
        ${song.musicXmlUrl || song.midiUrl ? `<section class="song-resource score-panel" id="interactive-score" data-song-id="${escapeHtml(song.id)}" data-learning-enabled="${song.learningEnabled === true}" data-learning-instruments="${escapeHtml((song.learningInstruments ?? []).join(","))}" data-private-preview="${options.privateDraftPreview === true}" data-musicxml-url="${escapeHtml(song.musicXmlUrl ?? "")}" data-midi-url="${escapeHtml(song.midiUrl ?? "")}" data-bpm="${song.bpm ?? 120}" aria-labelledby="score-title"><h2 id="score-title">${labels.score}</h2><p class="score-status" aria-live="polite">Loading score…</p><div class="score-controls"></div><div class="score-canvas"></div><div class="midi-controls"></div><div class="piano-keyboard" aria-label="Piano visualization"></div></section>` : ""}
      ${song.scorePdfUrl ? `<section class="song-resource pdf-panel" aria-labelledby="pdf-title"><h2 id="pdf-title">${labels.pdf}</h2><details><summary>${labels.pdfPreview}</summary><iframe src="${escapeHtml(song.scorePdfUrl)}#view=FitH" title="${labels.pdf}: ${title}" loading="lazy"></iframe></details></section>` : ""}
      ${resourceLinks ? `<section class="song-resource"><h2>${labels.resources}</h2><div class="resource-links">${resourceLinks}</div></section>` : ""}
      ${!song.audioUrl && !lyrics && !song.musicXmlUrl && !song.scorePdfUrl && !resourceLinks ? `<p class="detail-unavailable">${labels.noResources}</p>` : ""}
      ${song.youtubeVideoId ? `<section class="song-resource video-panel" aria-label="${labels.youtube}"><iframe src="${youtubePrivacyEmbedUrl(song.youtubeVideoId)}" title="${labels.youtube}: ${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></section>` : ""}
    </main>
  `;
}

export function renderSongNotFound(language: Language): string {
  return `<main class="song-detail shell" id="main-content" tabindex="-1"><a class="detail-back" href="#music"><span aria-hidden="true">←</span> ${language === "ka" ? "კატალოგში დაბრუნება" : "Back to catalog"}</a><div class="route-message"><p class="num">404 · SONG ARCHIVE</p><h1>${language === "ka" ? "ჩანაწერი ვერ მოიძებნა." : "Song not found."}</h1></div></main>`;
}
