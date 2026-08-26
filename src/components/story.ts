import type { Language } from "../i18n";

export function renderStory(language: Language): string {
  const heading = language === "ka" ? "სახელი მოკლეა. ხმა — არა." : "The name is short. The sound is not.";
  const copy = language === "ka"
    ? "ZURA აერთიანებს ატმოსფერულ ჟღერადობას, ელექტრონულ ენერგიასა და კინემატოგრაფიულ სივრცეს. ეს გვერდი არის მუსიკის, ვიზუალური სამყაროსა და მომავალი რელიზების ერთი სახლი."
    : "ZURA brings together atmospheric sound, electronic energy and cinematic space. This is one home for the music, the visual world and every release still to come.";

  return `
    <section class="story" id="story" aria-labelledby="story-title">
      <div class="shell story-grid">
        <div class="story-mark" aria-hidden="true">Z<span>URA</span></div>
        <div class="story-copy">
          <span class="num">02 · THE SIGNAL BEHIND THE SOUND</span>
          <h2 id="story-title">${heading}</h2>
          <p>${copy}</p>
        </div>
      </div>
    </section>
  `;
}
