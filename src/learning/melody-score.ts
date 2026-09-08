import type { NoteEvent } from "./contracts";
import { chooseContinuousGuitarPosition, type GuitarPosition } from "./instruments";

export interface MelodyScoreEntry {
  id: string;
  midi: number;
  startSeconds: number;
  durationSeconds: number;
  guitar: GuitarPosition | null;
}

export function buildMelodyScore(notes: readonly NoteEvent[]): MelodyScoreEntry[] {
  let previous: GuitarPosition | null = null;
  return notes.map((note) => {
    const guitar = chooseContinuousGuitarPosition(note, previous);
    if (guitar) previous = guitar;
    return { id: note.id, midi: note.midi, startSeconds: note.startSeconds, durationSeconds: note.durationSeconds, guitar };
  });
}

export class MelodyScoreView {
  private entries: MelodyScoreEntry[];
  private activeId = "";

  constructor(private readonly root: HTMLElement, notes: readonly NoteEvent[], private instrument: "piano" | "guitar" = "piano") {
    this.entries = buildMelodyScore(notes);
  }

  mount(): void { this.render(); }
  setNotes(notes: readonly NoteEvent[]): void { this.entries = buildMelodyScore(notes); this.render(); }
  setInstrument(instrument: "piano" | "guitar"): void { this.instrument = instrument; this.render(); }
  setActive(noteId: string | null): void {
    if ((noteId ?? "") === this.activeId) return;
    this.activeId = noteId ?? "";
    this.root.querySelectorAll<HTMLElement>("[data-melody-note]").forEach((node) => node.setAttribute("aria-current", String(node.dataset.melodyNote === this.activeId)));
    this.root.querySelector<HTMLElement>(`[data-melody-note="${CSS.escape(this.activeId)}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  private render(): void {
    const min = Math.min(...this.entries.map((entry) => entry.midi), 60);
    const max = Math.max(...this.entries.map((entry) => entry.midi), 72);
    this.root.replaceChildren();
    const strip = document.createElement("div");
    strip.className = "melody-score-strip";
    strip.setAttribute("role", "list");
    strip.setAttribute("aria-label", this.instrument === "guitar" ? "Independent guitar melody score" : "Independent piano melody score");
    for (const entry of this.entries) {
      const note = document.createElement("button");
      note.type = "button";
      note.className = "melody-score-note";
      note.dataset.melodyNote = entry.id;
      note.setAttribute("aria-current", String(entry.id === this.activeId));
      note.style.setProperty("--melody-y", String((max - entry.midi) / Math.max(1, max - min)));
      const name = `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][entry.midi % 12]}${Math.floor(entry.midi / 12) - 1}`;
      const guitar = entry.guitar ? ` · String ${entry.guitar.string} · Fret ${entry.guitar.fret}` : " · Out of guitar range";
      note.textContent = this.instrument === "guitar" && entry.guitar ? `${entry.guitar.string}/${entry.guitar.fret}` : "●";
      note.title = `${name}${this.instrument === "guitar" ? guitar : ""}`;
      note.setAttribute("aria-label", note.title);
      note.onclick = () => this.root.dispatchEvent(new CustomEvent("learning-melody-seek", { bubbles: true, detail: { noteId: entry.id } }));
      strip.append(note);
    }
    this.root.append(strip);
  }
}
