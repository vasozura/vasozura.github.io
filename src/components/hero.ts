import type { Language } from "../i18n";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderHero(language: Language): string {
  const copy = language === "ka"
    ? "მუსიკა, რომელიც ჩნდება სიჩუმესა და ხმაურს შორის — ZURA-ს ოფიციალური სივრცე."
    : "Music born between silence and noise — the official world of ZURA.";
  const listenLabel = language === "ka" ? "ZURA-ს YouTube არხის გახსნა" : "Open ZURA's YouTube channel";

  return `
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-media" aria-hidden="true"></div>
      <div class="shell hero-grid">
        <p class="eyebrow"><i aria-hidden="true"></i> INDEPENDENT ARTIST · TBILISI</p>
        <h1 id="hero-title"><span>HEAR</span><span>THE</span><em>UNSEEN.</em></h1>
        <p class="hero-copy">${copy}</p>
        <a class="play" href="${channelUrl}" aria-label="${listenLabel}">
          <b aria-hidden="true">▶</b>
          <span><small>LISTEN ON</small>YouTube Music</span>
        </a>
      </div>
    </section>
  `;
}
