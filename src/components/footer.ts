import type { Language } from "../i18n";

export function renderFooter(language: Language): string {
  return `
    <footer class="site-footer shell">
      <strong>ZURA</strong>
      <p>© 2026 ZURA. ${language === "ka" ? "ყველა უფლება დაცულია." : "ALL RIGHTS RESERVED."}</p>
      <a href="#top">${language === "ka" ? "ზემოთ" : "TOP"} <span aria-hidden="true">↑</span></a>
    </footer>
  `;
}
