export function renderTicker(): string {
  const line = "ALTERNATIVE ✦ ELECTRONIC ✦ CINEMATIC ✦ ZURA ✦";
  return `
    <div class="ticker-viewport" aria-hidden="true">
      <div class="ticker-track">
        <span>${line}</span><span>${line}</span>
      </div>
    </div>
  `;
}
