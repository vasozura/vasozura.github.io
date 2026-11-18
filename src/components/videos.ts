import type { Language } from "../i18n";
import type { Portfolio, PortfolioVideo } from "../data/portfolio";
import { escapeHtml } from "../utils/escape-html";
import { youtubeChannelUrl, youtubeSubscribeUrl } from "./links";

export const videosPageSize = 12;

function formatViews(views: number, language: Language): string {
  if (views <= 0) return "";
  const value = views >= 1000 ? `${(views / 1000).toFixed(views >= 100000 ? 0 : 1).replace(/\.0$/, "")}K` : String(views);
  return language === "ka" ? `${value} ნახვა` : `${value} views`;
}

function videoTitle(video: PortfolioVideo, language: Language): string {
  return language === "en" && video.titleEn ? video.titleEn : video.title;
}

function renderVideoTile(video: PortfolioVideo, language: Language, options: { featured?: boolean; hidden?: boolean } = {}): string {
  const title = escapeHtml(videoTitle(video, language));
  const poet = video.poet ? escapeHtml(video.poet) : "";
  const views = formatViews(video.views, language);
  const year = video.written ? video.written.slice(0, 4) : "";
  const meta = [poet, year, views].filter(Boolean).join(" · ");
  const playLabel = language === "ka" ? `${title} — ვიდეოს ჩართვა` : `Play ${title}`;
  const thumb = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  return `
    <article class="video-tile${options.featured ? " video-featured" : ""}"${options.hidden ? " hidden data-video-more-item" : ""}>
      <button class="video-frame" type="button" data-video-play="${escapeHtml(video.id)}" data-video-title="${title}" aria-label="${playLabel}">
        <img src="${thumb}" alt="" width="480" height="270" loading="${options.featured ? "eager" : "lazy"}" decoding="async" />
        <span class="video-play" aria-hidden="true">▶</span>
      </button>
      <div class="video-caption">
        <strong>${title}</strong>
        ${meta ? `<small>${meta}</small>` : ""}
        ${video.slug ? `<a href="#/song/${escapeHtml(video.slug)}">${language === "ka" ? "ტექსტი და აუდიო" : "Lyrics & audio"} <span aria-hidden="true">→</span></a>` : ""}
      </div>
    </article>
  `;
}

export function renderVideos(portfolio: Portfolio | null, language: Language): string {
  const videos = portfolio?.videos ?? [];
  if (!videos.length) return "";
  const featured = videos.find((video) => video.id === portfolio?.featured) ?? null;
  const rest = videos.filter((video) => video !== featured);
  const copy = language === "ka"
    ? { heading: "ვიდეო", featured: "ყველაზე ნანახი", lead: "მუსიკალური ვიდეოები — ახლიდან ძველისკენ. ვიდეო იტვირთება მხოლოდ დაჭერისას.", more: "მეტის ნახვა", subscribe: "გამოიწერე არხი", channel: "ყველა ვიდეო YouTube-ზე" }
    : { heading: "Videos", featured: "Most watched", lead: "Music videos, newest first. Each video loads only when you press play.", more: "Show more", subscribe: "Subscribe", channel: "All videos on YouTube" };

  return `
    <section class="videos shell" id="videos" aria-labelledby="videos-title">
      <div class="section-head">
        <span class="num">01 · MUSIC VIDEOS</span>
        <h2 id="videos-title">${copy.heading}</h2>
        <a class="all-releases" href="${youtubeChannelUrl}" target="_blank" rel="noopener noreferrer">${copy.channel} <span aria-hidden="true">↗</span></a>
      </div>
      <p class="videos-lead">${copy.lead}</p>
      ${featured ? `<div class="video-feature-wrap"><p class="video-badge">${copy.featured}</p>${renderVideoTile(featured, language, { featured: true })}</div>` : ""}
      <div class="video-grid">
        ${rest.map((video, index) => renderVideoTile(video, language, { hidden: index >= videosPageSize })).join("")}
      </div>
      <div class="videos-actions">
        ${rest.length > videosPageSize ? `<button class="videos-more" type="button" data-videos-more>${copy.more}</button>` : ""}
        <a class="videos-subscribe" href="${youtubeSubscribeUrl}" target="_blank" rel="noopener noreferrer"><b aria-hidden="true">▶</b> ${copy.subscribe}</a>
      </div>
    </section>
  `;
}

/** Click-to-load: the YouTube player is only created when a visitor presses play. */
export function bindVideos(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-video-play]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.videoPlay ?? "";
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      iframe.title = button.dataset.videoTitle ?? "YouTube video";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.className = "video-iframe";
      button.replaceWith(iframe);
    }, { once: true });
  });
  const more = root.querySelector<HTMLButtonElement>("[data-videos-more]");
  more?.addEventListener("click", () => {
    const hidden = [...root.querySelectorAll<HTMLElement>("[data-video-more-item][hidden]")];
    hidden.slice(0, videosPageSize).forEach((item) => { item.hidden = false; });
    if (hidden.length <= videosPageSize) more.hidden = true;
  });
}
