import type { Language } from "../i18n";

export function renderNavigation(language: Language): string {
  const labels = language === "ka"
    ? { aria: "მთავარი ნავიგაცია", videos: "ვიდეო", music: "მუსიკა", services: "სერვისები", story: "ამბავი", contact: "კონტაქტი" }
    : { aria: "Primary navigation", videos: "Videos", music: "Music", services: "Services", story: "Story", contact: "Contact" };

  return `
    <nav class="primary-nav" aria-label="${labels.aria}">
      <a href="#videos">${labels.videos}</a>
      <a href="#music">${labels.music}</a>
      <a href="#services">${labels.services}</a>
      <a href="#story">${labels.story}</a>
      <a href="#contact">${labels.contact}</a>
    </nav>
  `;
}
