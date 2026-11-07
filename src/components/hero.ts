import type { Language } from "../i18n";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderHero(language: Language, releaseCount: number): string {
  const copy = language === "ka"
    ? "კომპოზიტორის ცოცხალი არქივი — სიმღერები, ტექსტები, ნოტები და შესრულებისთვის მომზადებული მუსიკალური მასალა ერთ სივრცეში."
    : "A living composer archive — songs, lyrics, scores and performance-ready musical material in one place.";
  const listenLabel = language === "ka" ? "ZURA-ს YouTube არხის გახსნა" : "Open ZURA's YouTube channel";
  const explore = language === "ka" ? "არქივის დათვალიერება" : "Explore the archive";
  const story = language === "ka" ? "ZURA-ს შესახებ" : "About ZURA";
  const releaseLabel = language === "ka" ? "ჩანაწერი არქივში" : "releases in the archive";
  const archiveLabel = language === "ka" ? "ოფიციალური კომპოზიტორის არქივი" : "Official composer archive";

  return `
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-media" aria-hidden="true"></div>
      <div class="shell hero-grid">
        <div class="hero-content">
          <p class="eyebrow"><i aria-hidden="true"></i> ${archiveLabel}</p>
          <h1 id="hero-title"><span>HEAR</span><span>THE</span><em>UNSEEN.</em></h1>
          <p class="hero-copy">${copy}</p>
          <div class="hero-actions">
            <a class="hero-primary" href="#music">${explore} <span aria-hidden="true">↓</span></a>
            <a class="hero-secondary" href="#story">${story} <span aria-hidden="true">↘</span></a>
          </div>
        </div>
        <aside class="hero-archive-note" aria-label="${releaseCount} ${releaseLabel}">
          <strong>${String(releaseCount).padStart(2, "0")}</strong>
          <span>${releaseLabel}</span>
          <a href="${channelUrl}" aria-label="${listenLabel}"><b aria-hidden="true">▶</b> YouTube</a>
        </aside>
      </div>
    </section>
  `;
}
