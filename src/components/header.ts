import type { Language } from "../i18n";
import { renderLanguageSwitcher } from "./language-switcher";
import { renderNavigation } from "./navigation";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderHeader(language: Language): string {
  const listen = language === "ka" ? "მოსმენა" : "Listen";

  return `
    <header class="site-header shell">
      <a class="brand" href="#top" aria-label="ZURA — ${language === "ka" ? "მთავარი" : "home"}">
        <img src="/assets/zv-logo.webp" width="52" height="52" alt="" />
        <span>ZURA</span>
      </a>
      ${renderNavigation(language)}
      <div class="nav-actions">
        ${renderLanguageSwitcher(language)}
        <a class="header-listen" href="${channelUrl}">
          <span class="listen-text">${listen}</span><span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
  `;
}
