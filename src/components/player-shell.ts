import { localize, type Language } from "../i18n";
import type { Song } from "../types/song";
import { escapeHtml } from "../utils/escape-html";

export function renderPlayerShell(language: Language, songs: Song[]): string {
  const available = songs.filter((song) => Boolean(song.audioUrl));
  const labels = language === "ka"
    ? { player: "გლობალური აუდიო ფლეერი", previous: "წინა", next: "შემდეგი", shuffle: "შემთხვევითი რიგი", repeat: "გამეორება", seek: "დრო", volume: "ხმა", queue: "რიგი", empty: "MP3 აუდიო ჯერ არ არის დამატებული" }
    : { player: "Global audio player", previous: "Previous", next: "Next", shuffle: "Shuffle", repeat: "Repeat", seek: "Seek", volume: "Volume", queue: "Queue", empty: "No MP3 audio is available yet" };

  return `
    <aside class="player-shell" aria-label="${labels.player}">
      <div class="player-buttons">
        <button id="player-shuffle" type="button" aria-label="${labels.shuffle}" aria-pressed="false">⇄</button>
        <button id="player-prev" type="button" aria-label="${labels.previous}" ${available.length ? "" : "disabled"}>│◀</button>
        <button id="player-play" type="button" aria-label="Play" ${available.length ? "" : "disabled"}>▶</button>
        <button id="player-next" type="button" aria-label="${labels.next}" ${available.length ? "" : "disabled"}>▶│</button>
        <button id="player-repeat" type="button" aria-label="${labels.repeat}" aria-pressed="false" data-mode="off">↻</button>
      </div>
      <p class="player-track-copy"><small>PLAYER · ARCHIVE</small><strong id="player-track">${labels.empty}</strong></p>
      <label class="player-seek"><span class="sr-only">${labels.seek}</span><input id="player-seek" type="range" min="0" max="0" value="0" step="0.1" /></label>
      <label class="player-volume"><span aria-hidden="true">◖</span><span class="sr-only">${labels.volume}</span><input id="player-volume" type="range" min="0" max="1" value="1" step="0.05" /></label>
      <details class="player-queue"><summary>${labels.queue} · ${available.length}</summary><ol>${available.map((song) => `<li><button type="button" data-queue-song="${escapeHtml(song.id)}">${escapeHtml(localize(song.title, language) ?? song.slug)}</button></li>`).join("")}</ol></details>
    </aside>
  `;
}
