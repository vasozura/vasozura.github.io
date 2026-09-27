import type { NoteEvent } from "./contracts";
import { normalizedAccordionButtons, standardPianoAccordionConfig, type AccordionConfig, type AuditionCallbacks, type TimelineVisualizer } from "./instruments";

type AccordionInput = AccordionConfig | Parameters<typeof normalizedAccordionButtons>[0] | null;

export class AccordionVisualizer implements TimelineVisualizer {
  private follow = false;
  constructor(private readonly root: HTMLElement, private readonly config: AccordionInput = standardPianoAccordionConfig, private readonly audition?: AuditionCallbacks) {}

  setFollow(enabled: boolean): void { this.follow = enabled; }

  mount(): void {
    this.root.classList.add("learning-accordion");
    const config = this.config ?? standardPianoAccordionConfig;
    const buttons = normalizedAccordionButtons(config);
    const renderSide = (side: "right" | "left", label: string): string => {
      const sideButtons = buttons.filter((button) => button.side === side).sort((a, b) => a.row - b.row || a.column - b.column);
      if (!sideButtons.length) return `<section class="accordion-side unavailable"><h4>${label}</h4><p>Verified mapping unavailable.</p></section>`;
      const rows = [...new Set(sideButtons.map((button) => button.row))];
      return `<section class="accordion-side accordion-${side}" aria-label="${label}"><h4>${label}</h4>${rows.map((row) => `<div class="accordion-row" data-row="${row}">${sideButtons.filter((button) => button.row === row).map((button) => `<button type="button" class="accordion-button provenance-${button.provenance}" data-button="${button.id}" data-notes="${button.midi.join(",")}" data-midi-note="${button.midi[0]}" aria-label="${button.label ?? button.id}; MIDI ${button.midi.join(", ")}; ${button.provenance}${button.bellows ? `; bellows ${button.bellows}` : ""}${button.finger ? `; finger ${button.finger}` : ""}">${button.label ?? button.id}</button>`).join("")}</div>`).join("")}</section>`;
    };
    this.root.innerHTML = `<p class="accordion-layout-status">${config.system.replaceAll("_", " ")} · verified right-hand mapping</p><div class="accordion-boards">${renderSide("right", "Right hand")}${renderSide("left", "Left hand bass")}</div><p class="accordion-provenance">Right hand: conventional 41-key F3–A6 piano accordion. Left-hand bass mapping is not available. Audio: CC0 Tomiak Chemnitzer samples.</p>`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-midi-note]").forEach((key) => {
      const start = (event: PointerEvent): void => { event.preventDefault(); key.classList.add("manual-audition"); key.setPointerCapture?.(event.pointerId); this.audition?.noteOn(Number(key.dataset.midiNote), "accordion"); };
      const stop = (): void => { key.classList.remove("manual-audition"); this.audition?.noteOff(); };
      key.addEventListener("pointerdown", start);
      key.addEventListener("pointerup", stop);
      key.addEventListener("pointercancel", stop);
      key.addEventListener("pointerleave", stop);
      key.addEventListener("lostpointercapture", stop);
    });
  }

  render(active: NoteEvent[], upcoming: NoteEvent[]): void {
    const activePitches = new Set(active.map((note) => note.midi));
    const upcomingPitches = new Set(upcoming.map((note) => note.midi));
    this.root.querySelectorAll<HTMLElement>("[data-notes]").forEach((element) => {
      const pitches = (element.dataset.notes ?? "").split(",").map(Number);
      element.classList.toggle("active", pitches.some((midi) => activePitches.has(midi)));
      element.classList.toggle("upcoming", pitches.some((midi) => upcomingPitches.has(midi)));
    });
    const activeButton = this.follow && active[0]
      ? this.root.querySelector<HTMLElement>(".active[data-notes]")
      : null;
    const scroller = activeButton?.closest<HTMLElement>(".accordion-side");
    if (activeButton && scroller) {
      const target = activeButton.offsetLeft + activeButton.offsetWidth / 2 - scroller.clientWidth / 2;
      scroller.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    }
  }

  destroy(): void { this.root.replaceChildren(); this.root.className = ""; }
}
