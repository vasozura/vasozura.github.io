import type { Language } from "../i18n";

export function renderStory(language: Language): string {
  const heading = language === "ka" ? "ერთი სახელი. უსაზღვრო ჟღერადობა." : "One name. Limitless resonance.";
  const copy = language === "ka"
    ? "ZURA აერთიანებს ატმოსფერულ ჟღერადობას, ელექტრონულ ენერგიასა და კინემატოგრაფიულ სივრცეს. ეს გვერდი არის მუსიკის, ვიზუალური სამყაროსა და მომავალი რელიზების ერთი სახლი."
    : "ZURA brings together atmospheric sound, electronic energy and cinematic space. This is one home for the music, the visual world and every release still to come.";
  const signals = language === "ka"
    ? [["01", "შექმნა"], ["02", "არქივი"], ["03", "შესრულება"]]
    : [["01", "Compose"], ["02", "Archive"], ["03", "Perform"]];

  return `
    <section class="story" id="story" aria-labelledby="story-title">
      <div class="shell story-grid">
        <div class="story-visual" aria-hidden="true">
          <div class="story-mark">Z<span>URA</span></div>
          <div class="story-rings"><i></i><i></i><i></i></div>
        </div>
        <div class="story-copy">
          <span class="num">02 · THE SIGNAL BEHIND THE SOUND</span>
          <h2 id="story-title">${heading}</h2>
          <p>${copy}</p>
          <div class="story-signals" aria-label="${language === "ka" ? "ZURA-ს შემოქმედებითი ციკლი" : "ZURA creative cycle"}">
            ${signals.map(([number, label]) => `<span><b>${number}</b>${label}</span>`).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}
