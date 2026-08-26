import type { Language } from "../i18n";

export function renderPlayerShell(language: Language): string {
  const title = language === "ka" ? "გლობალური ფლეერის საფუძველი" : "Global player foundation";
  const message = language === "ka" ? "აუდიო ჯერ არ არის დამატებული" : "Audio is not available yet";

  return `
    <aside class="player-shell" aria-label="${title}">
      <button type="button" disabled aria-label="${message}"><span aria-hidden="true">▶</span></button>
      <span class="player-line" aria-hidden="true"></span>
      <p><small>PLAYER · PHASE 1</small><strong>${message}</strong></p>
    </aside>
  `;
}
