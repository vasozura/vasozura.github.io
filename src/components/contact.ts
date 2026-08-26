import type { Language } from "../i18n";

const channelUrl = "https://www.youtube.com/@Zuravasadze-w5x";

export function renderContact(language: Language): string {
  const linkText = language === "ka" ? "ნახე ჩემი YouTube არხი" : "Visit my YouTube channel";

  return `
    <section class="contact shell" id="contact" aria-labelledby="contact-title">
      <p>BOOKING · COLLABORATIONS · PRESS</p>
      <h2 id="contact-title">LET’S MAKE<br /><em>NOISE.</em></h2>
      <a href="${channelUrl}"><span>${linkText}</span><span aria-hidden="true">↗</span></a>
    </section>
  `;
}
