import type { NoteEvent } from "./contracts";
import { normalizedAccordionButtons, type AccordionConfig, type TimelineVisualizer } from "./instruments";

type AccordionInput = AccordionConfig | Parameters<typeof normalizedAccordionButtons>[0] | null;

export class AccordionVisualizer implements TimelineVisualizer {
  private follow = true;
  constructor(private readonly root: HTMLElement, private readonly config: AccordionInput) {}

  setFollow(enabled: boolean): void { this.follow = enabled; }

  mount(): void {
    this.root.classList.add("learning-accordion");
    if (!this.config) {
      this.root.innerHTML = '<p class="learning-placeholder">Accordion visualization requires a verified part and button mapping.</p>';
      return;
    }
    const buttons = normalizedAccordionButtons(this.config);
    const renderSide = (side: "right" | "left", label: string): string => {
      const sideButtons = buttons.filter((button) => button.side === side).sort((a, b) => a.row - b.row || a.column - b.column);
      if (!sideButtons.length) return `<section class="accordion-side unavailable"><h4>${label}</h4><p>Verified mapping unavailable.</p></section>`;
      const rows = [...new Set(sideButtons.map((button) => button.row))];
      return `<section class="accordion-side accordion-${side}" aria-label="${label}"><h4>${label}</h4>${rows.map((row) => `<div class="accordion-row" data-row="${row}">${sideButtons.filter((button) => button.row === row).map((button) => `<span class="accordion-button provenance-${button.provenance}" data-button="${button.id}" data-notes="${button.midi.join(",")}" role="img" aria-label="${button.label ?? button.id}; ${button.provenance}${button.bellows ? `; bellows ${button.bellows}` : ""}${button.finger ? `; finger ${button.finger}` : ""}">${button.label ?? button.id}</span>`).join("")}</div>`).join("")}</section>`;
    };
    this.root.innerHTML = `<p class="accordion-layout-status">${this.config.system.replaceAll("_", " ")} · verified mapping</p><div class="accordion-boards">${renderSide("right", "Right hand")}${renderSide("left", "Left hand bass")}</div><p class="accordion-provenance">Source-authored and deterministic positions are labelled. Inferred positions are advisory only.</p>`;
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    const activePitches = new Set(active.map((note) => note.midi));
    const upcomingPitches = new Set(upcoming.map((note) => note.midi));
    this.root.querySelectorAll<HTMLElement>("[data-notes]").forEach((element) => {
      const pitches = (element.dataset.notes ?? "").split(",").map(Number);
      element.classList.toggle("active", pitches.some((midi) => activePitches.has(midi)));
      element.classList.toggle("upcoming", pitches.some((midi) => upcomingPitches.has(midi)));
    });
    if (this.follow && active[0]) this.root.querySelector<HTMLElement>(".active[data-notes]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
