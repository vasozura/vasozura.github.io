import type { Language } from "../i18n";

export function renderLanguageSwitcher(language: Language): string {
  const label = language === "ka" ? "Switch to English" : "ქართულ ენაზე გადართვა";
  const nextLanguage = language === "ka" ? "EN" : "KA";

  return `
    <button class="lang-toggle" id="language-toggle" type="button" aria-label="${label}">
      ${nextLanguage}
    </button>
  `;
}
