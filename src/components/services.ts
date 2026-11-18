import type { Language } from "../i18n";
import { youtubeChannelUrl } from "./links";

interface Service { title: string; text: string; points: string[] }

const services: Record<Language, Service[]> = {
  en: [
    { title: "AI music video", text: "A cinematic video for your song: consistent characters, mood and story built around the lyrics.", points: ["Full-length, up to 1080p", "16:9, 9:16 or 1:1", "Lyric captions on request"] },
    { title: "Custom song", text: "An original song in English or Georgian, written to your idea, occasion or poem — melody by a working composer.", points: ["Lyrics + melody + full arrangement", "Ready-to-share MP3", "Optional lyric video"] },
    { title: "Local AI video setup", text: "Setup of a local AI video pipeline (Wan2GP) on your own GPU, with a working workflow and presets.", points: ["Remote setup session", "Character-consistent presets", "Short written guide"] },
  ],
  ka: [
    { title: "AI მუსიკალური ვიდეო", text: "კინემატოგრაფიული ვიდეო შენს სიმღერაზე — ერთიანი პერსონაჟები, განწყობა და სიუჟეტი ტექსტის მიხედვით.", points: ["სრული სიგრძე, 1080p-მდე", "16:9, 9:16 ან 1:1", "ტექსტის სუბტიტრები სურვილისამებრ"] },
    { title: "სიმღერა შეკვეთით", text: "ორიგინალური სიმღერა ინგლისურად ან ქართულად — შენი იდეის, შემთხვევის ან ლექსის მიხედვით.", points: ["ტექსტი + მელოდია + არანჟირება", "MP3 გასაზიარებლად", "ტექსტიანი ვიდეო სურვილისამებრ"] },
    { title: "ლოკალური AI ვიდეოს გამართვა", text: "Wan2GP-ის გამართვა შენს კომპიუტერზე, მზა workflow-ით და პრესეტებით.", points: ["დისტანციური გამართვა", "პერსონაჟის მდგრადობის პრესეტები", "მოკლე ინსტრუქცია"] },
  ],
};

export function renderServices(language: Language): string {
  const copy = language === "ka"
    ? { heading: "სერვისები", lead: "ვმუშაობ კლიენტებთან მთელი მსოფლიოდან. ნიმუშები — ზემოთ, ვიდეოების სექციაში.", cta: "დამიკავშირდი YouTube-ის გავლით" }
    : { heading: "Services", lead: "I work with clients worldwide. The videos above are my portfolio.", cta: "Get in touch via YouTube" };
  return `
    <section class="services shell" id="services" aria-labelledby="services-title">
      <div class="section-head">
        <span class="num">03 · WORK WITH ME</span>
        <h2 id="services-title">${copy.heading}</h2>
      </div>
      <p class="videos-lead">${copy.lead}</p>
      <div class="service-grid">
        ${services[language].map((service, index) => `
          <article class="service-card">
            <span class="num">0${index + 1}</span>
            <h3>${service.title}</h3>
            <p>${service.text}</p>
            <ul>${service.points.map((point) => `<li>${point}</li>`).join("")}</ul>
          </article>`).join("")}
      </div>
      <a class="services-cta" href="${youtubeChannelUrl}/about" target="_blank" rel="noopener noreferrer">${copy.cta} <span aria-hidden="true">↗</span></a>
    </section>
  `;
}
