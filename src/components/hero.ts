import type { Language } from "../i18n";

import { appleMusicArtistUrl, youtubeChannelUrl as channelUrl, spotifyArtistUrl, youtubeSubscribeUrl } from "./links";

export function renderHero(language: Language, releaseCount: number): string {
  const copy = language === "ka"
    ? "კომპოზიტორი ZURA — ქართველი პოეტების ლექსებზე დაწერილი სიმღერები, მუსიკალური ვიდეოები, ტექსტები და ნოტები ერთ სივრცეში."
    : "Composer ZURA — songs set to the poetry of Georgian authors, music videos, lyrics and scores in one place.";
  const listenLabel = language === "ka" ? "ZURA-ს YouTube არხის გახსნა" : "Open ZURA's YouTube channel";
  const explore = language === "ka" ? "ვიდეოების ნახვა" : "Watch the videos";
  const subscribe = language === "ka" ? "გამოიწერე YouTube-ზე" : "Subscribe on YouTube";
  const story = language === "ka" ? "ZURA-ს შესახებ" : "About ZURA";
  const releaseLabel = language === "ka" ? "გამოქვეყნებული ჩანაწერი" : "published releases";
  const archiveLabel = language === "ka" ? "ოფიციალური კომპოზიტორის არქივი" : "Official composer archive";
  const titleLine = language === "ka" ? "მუსიკა · ტექსტები · ნოტები" : "Music · lyrics · scores";

  return `
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-media" aria-hidden="true"></div>
      <div class="hero-aurora" aria-hidden="true"></div>
      <div class="hero-signal" aria-hidden="true">
        ${[18, 34, 57, 82, 46, 71, 28, 64, 92, 51, 76, 39, 68, 24, 49, 86, 61, 31, 73, 43].map((height, index) => `<i style="--bar:${height}%;--delay:${index * -0.07}s"></i>`).join("")}
      </div>
      <div class="shell hero-grid">
        <div class="hero-content">
          <p class="eyebrow"><i aria-hidden="true"></i> ${archiveLabel}</p>
          <h1 id="hero-title">ZURA</h1>
          <p class="hero-subtitle">${titleLine}</p>
          <p class="hero-copy">${copy}</p>
          <div class="hero-actions">
            <a class="hero-primary" href="#videos">${explore} <span aria-hidden="true">↓</span></a>
            <a class="hero-secondary" href="${youtubeSubscribeUrl}" target="_blank" rel="noopener noreferrer">${subscribe} <span aria-hidden="true">↗</span></a>
            <a class="hero-secondary" href="${spotifyArtistUrl}" target="_blank" rel="noopener noreferrer">Spotify <span aria-hidden="true">↗</span></a>
            <a class="hero-secondary" href="${appleMusicArtistUrl}" target="_blank" rel="noopener noreferrer">Apple Music <span aria-hidden="true">↗</span></a>
            <a class="hero-secondary hero-tertiary" href="#story">${story} <span aria-hidden="true">↘</span></a>
          </div>
        </div>
        <aside class="hero-archive-note" aria-label="${releaseCount} ${releaseLabel}" data-release-label="${releaseLabel}">
          <span class="live-signal"><i aria-hidden="true"></i> LIVE ARCHIVE</span>
          <strong id="hero-release-count">${String(releaseCount).padStart(2, "0")}</strong>
          <span>${releaseLabel}</span>
          <a href="${channelUrl}" aria-label="${listenLabel}"><b aria-hidden="true">▶</b> YouTube</a>
        </aside>
      </div>
    </section>
  `;
}
