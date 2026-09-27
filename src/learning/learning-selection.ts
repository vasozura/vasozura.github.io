import type { InstrumentName } from "../audio/sample-instrument";
import { normalizedAccordionButtons, standardPianoAccordionConfig, type AccordionConfig } from "./instruments";
import { noteMatchesStaffScope, type StaffScope } from "./playback-selection";
import type { ActiveTrackOption } from "./voice-lanes";

export interface LearningSelectionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }
export interface RememberedLearningSelection { activeTrackId: string | null; staffScope: StaffScope; }
export interface StaffScopeSupport { treble: boolean; bass: boolean; both: boolean; inferred: boolean; }

const PREFIX = "zura-learning-selection:v1:";

export const learningSelectionControlsHtml = `<fieldset class="learning-control-group" data-l="part-group"><legend>ACTIVE TRACK</legend><select data-l="active-track" aria-label="Active track"></select></fieldset><fieldset class="learning-control-group learning-segments" data-l="staff-group"><legend>STAFF</legend><button type="button" data-staff-scope="treble" aria-pressed="false">TREBLE</button><button type="button" data-staff-scope="bass" aria-pressed="false">BASS</button><button type="button" data-staff-scope="both" aria-pressed="true">BOTH</button><small data-l="staff-source"></small></fieldset>`;
export const learningVisualizerHtml = `<div class="learning-visualizer-panel"><p class="learning-visualizer-unavailable" data-l="visualizer-unavailable" role="status" hidden></p><div data-l="visualizer" aria-live="off"></div></div>`;

export function learningSelectionStorageKey(songId: string): string { return `${PREFIX}${encodeURIComponent(songId)}`; }

export function rememberLearningSelection(storage: LearningSelectionStorage, songId: string, selection: RememberedLearningSelection): void {
  storage.setItem(learningSelectionStorageKey(songId), JSON.stringify(selection));
}

export function restoreLearningSelection(storage: LearningSelectionStorage, songId: string): RememberedLearningSelection | null {
  try {
    const parsed = JSON.parse(storage.getItem(learningSelectionStorageKey(songId)) ?? "null") as Partial<RememberedLearningSelection> | null;
    if (!parsed || !["treble", "bass", "both"].includes(String(parsed.staffScope))) return null;
    return { activeTrackId: typeof parsed.activeTrackId === "string" ? parsed.activeTrackId : null, staffScope: parsed.staffScope as StaffScope };
  } catch { return null; }
}

export function staffScopeSupport(option: ActiveTrackOption | null): StaffScopeSupport {
  const notes = option?.lane.notes ?? [];
  const inferred = notes.length > 0 && notes.every((note) => note.staff == null && note.hand === "unknown");
  return {
    treble: notes.some((note) => noteMatchesStaffScope(note, "treble")),
    bass: notes.some((note) => noteMatchesStaffScope(note, "bass")),
    both: notes.length > 0,
    inferred,
  };
}

export function resolveStaffScope(requested: StaffScope | null | undefined, support: StaffScopeSupport): StaffScope {
  if (requested && support[requested]) return requested;
  return support.both ? "both" : support.treble ? "treble" : support.bass ? "bass" : "both";
}

export function visualizerAvailability(instrument: InstrumentName, option: ActiveTrackOption | null, scope: StaffScope, accordionConfig: AccordionConfig | null): { available: boolean; reason: string } {
  const notes = (option?.lane.notes ?? []).filter((note) => noteMatchesStaffScope(note, scope));
  const accordionButtons = instrument === "accordion" ? normalizedAccordionButtons(accordionConfig ?? standardPianoAccordionConfig) : [];
  if (instrument === "accordion" && scope === "bass" && !accordionButtons.some((button) => button.side === "left")) return { available: false, reason: "Accordion left-hand bass visualization is unsupported; choose Treble or a right-hand track." };
  if (!option || !notes.length) return { available: false, reason: "No notes are available for this track and staff selection." };
  if (instrument === "guitar" && notes.some((note) => note.midi < 40 || note.midi > 84)) return { available: false, reason: "Guitar visualization is unavailable for notes outside E2–C6." };
  if (instrument === "piano" && notes.some((note) => note.midi < 21 || note.midi > 108)) return { available: false, reason: "Piano visualization is unavailable for notes outside A0–C8." };
  if (instrument === "accordion") {
    const right = new Set(accordionButtons.filter((button) => button.side === "right").flatMap((button) => button.midi));
    const left = new Set(accordionButtons.filter((button) => button.side === "left").flatMap((button) => button.midi));
    const needsLeft = scope === "bass" || (scope === "both" && notes.some((note) => noteMatchesStaffScope(note, "bass")));
    if (needsLeft && !left.size) return { available: false, reason: "Accordion left-hand bass visualization is unsupported; choose Treble or a right-hand track." };
    if (notes.some((note) => !(right.has(note.midi) || left.has(note.midi)))) return { available: false, reason: "Accordion visualization is unavailable for notes outside the verified mapping." };
  }
  return { available: true, reason: "" };
}

export function renderActiveTrackOptions(select: HTMLSelectElement, options: readonly ActiveTrackOption[], selectedId: string): void {
  select.replaceChildren(...options.map((option) => new Option(option.label, option.id)));
  select.value = selectedId;
}

export function applyStaffControlState(host: HTMLElement, selected: StaffScope, support: StaffScopeSupport): void {
  host.querySelectorAll<HTMLButtonElement>("[data-staff-scope]").forEach((button) => {
    const scope = button.dataset.staffScope as StaffScope;
    button.disabled = !support[scope];
    button.setAttribute("aria-pressed", String(scope === selected));
  });
  host.querySelector<HTMLElement>('[data-l="staff-source"]')!.textContent = support.inferred ? "INFERRED" : "SOURCE";
}

export function applyVisualizerAvailability(visualizer: HTMLElement, message: HTMLElement, state: { available: boolean; reason: string }): void {
  visualizer.hidden = !state.available;
  message.hidden = state.available;
  message.textContent = state.reason;
}
