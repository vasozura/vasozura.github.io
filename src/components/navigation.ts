import type { Language } from "../i18n";

export function renderNavigation(language: Language): string {
  const labels = language === "ka"
    ? { aria: "მთავარი ნავიგაცია", music: "მუსიკა", story: "ამბავი", contact: "კონტაქტი" }
    : { aria: "Primary navigation", music: "Music", story: "Story", contact: "Contact" };

  return `
    <nav class="primary-nav" aria-label="${labels.aria}">
      <a href="#music">${labels.music}</a>
      <a href="#story">${labels.story}</a>
      <a href="#contact">${labels.contact}</a>
    </nav>
  `;
}
