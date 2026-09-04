import { getInitialLanguage, type Language } from "../i18n";
import { MidiPlayback } from "./midi-playback";
import { PianoVisualizer } from "./instrument-visualizer";

export function enableMidiSeek(progress: HTMLInputElement | null): void {
  if (progress) progress.disabled = false;
}

export async function fetchScoreSource(url: string, request: typeof fetch = fetch): Promise<Blob> {
  const response = await request(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`MusicXML unavailable (${response.status})`);
  return response.blob();
}

export interface ScoreViewerOptions { midiPlayback?: boolean; }
export const shouldMountStandaloneMidi = (options: ScoreViewerOptions): boolean => options.midiPlayback !== false;

export function getScoreCopy(language: Language) {
  return language === "ka" ? {
    zoomOut: "დაპატარავება", zoomIn: "გადიდება", layout: "განლაგება", page: "გვერდი", continuous: "უწყვეტი", previousPage: "წინა გვერდი", nextPage: "შემდეგი გვერდი", previousMeasure: "წინა ზომა", nextMeasure: "შემდეგი ზომა", measure: "ზომა", cursor: "კურსორი", loaded: "MusicXML ნოტები ჩაიტვირთა.", scoreFailed: "ნოტების ჩატვირთვა ვერ მოხერხდა.", notationUnavailable: "ნოტები მიუწვდომელია; MIDI სწავლა კვლავ ხელმისაწვდომია.", midiUnavailable: "ამ ნოტებისთვის MIDI დაკვრა მიუწვდომელია.", playPause: "დაკვრა / პაუზა", stop: "გაჩერება", tempo: "ტემპი", metronome: "მეტრონომი", position: "პოზიცია", seconds: "წამი", setLoop: "A–B ციკლის დაყენება", clearLoop: "ციკლის გაუქმება", midiFailed: "MIDI-ს ჩატვირთვა ვერ მოხერხდა.",
  } : {
    zoomOut: "Zoom out", zoomIn: "Zoom in", layout: "Layout", page: "Page", continuous: "Continuous", previousPage: "Previous page", nextPage: "Next page", previousMeasure: "Previous measure", nextMeasure: "Next measure", measure: "Measure", cursor: "Cursor", loaded: "MusicXML score loaded.", scoreFailed: "The score could not be loaded.", notationUnavailable: "Notation is unavailable; MIDI learning remains available.", midiUnavailable: "MIDI playback is not available for this score.", playPause: "Play / pause", stop: "Stop", tempo: "Tempo", metronome: "Metronome", position: "Position", seconds: "seconds", setLoop: "Set A–B loop", clearLoop: "Clear loop", midiFailed: "MIDI could not be loaded.",
  };
}

export async function mountScoreViewer(
  root: HTMLElement,
  options: ScoreViewerOptions = {},
): Promise<() => void> {
  const copy = getScoreCopy(getInitialLanguage());
  const cleanups: Array<() => void> = [];
  const musicXmlUrl = root.dataset.musicxmlUrl;
  const canvas = root.querySelector<HTMLElement>(".score-canvas");
  const controls = root.querySelector<HTMLElement>(".score-controls");
  const status = root.querySelector<HTMLElement>(".score-status");
  const midiControls = root.querySelector<HTMLElement>(".midi-controls");
  const piano = root.querySelector<HTMLElement>(".piano-keyboard");
  if (!canvas || !controls || !status || !midiControls || !piano) return () => {};

  if (musicXmlUrl) try {
    const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
    const osmd = new OpenSheetMusicDisplay(canvas, { autoResize: true, backend: "svg", drawTitle: true, followCursor: true });
    await osmd.load(await fetchScoreSource(musicXmlUrl));
    osmd.render();
    osmd.cursor.show();
    let learningCursorStep = -1;
    const moveLearningCursor = (event: Event): void => {
      const target = Number((event as CustomEvent<{ cursorStep: number }>).detail.cursorStep);
      if (!Number.isInteger(target) || target === learningCursorStep) return;
      if (target < learningCursorStep) { osmd.cursor.reset(); learningCursorStep = -1; }
      while (learningCursorStep < target) { osmd.cursor.next(); learningCursorStep += 1; }
      osmd.cursor.show();
    };
    root.addEventListener("learning-score-cursor", moveLearningCursor);
    cleanups.push(() => root.removeEventListener("learning-score-cursor", moveLearningCursor));
    let zoom = 1;
    let page = 0;
    let measure = 1;
    let pageMode = true;
    const pages = () => [...canvas.querySelectorAll<HTMLElement>(".osmd-page")];
    const showPage = (): void => {
      const list = pages();
      if (!pageMode) { list.forEach((entry) => { entry.hidden = false; }); return; }
      if (list.length <= 1) return;
      page = Math.max(0, Math.min(page, list.length - 1));
      list.forEach((entry, index) => { entry.hidden = index !== page; });
      controls.querySelector<HTMLElement>("[data-page-label]")!.textContent = `${page + 1} / ${list.length}`;
    };
    controls.innerHTML = `<button type="button" data-score-action="zoom-out" aria-label="${copy.zoomOut}">−</button><output data-zoom-label>100%</output><button type="button" data-score-action="zoom-in" aria-label="${copy.zoomIn}">+</button><label>${copy.layout} <select data-score-layout><option value="page">${copy.page}</option><option value="continuous">${copy.continuous}</option></select></label><button type="button" data-score-action="prev-page" aria-label="${copy.previousPage}">← ${copy.page.toLowerCase()}</button><output data-page-label>1 / ${Math.max(1, pages().length)}</output><button type="button" data-score-action="next-page" aria-label="${copy.nextPage}">${copy.page.toLowerCase()} →</button><button type="button" data-score-action="prev-measure" aria-label="${copy.previousMeasure}">← ${copy.measure.toLowerCase()}</button><output data-measure-label>${copy.measure} 1</output><button type="button" data-score-action="next-measure" aria-label="${copy.nextMeasure}">${copy.measure.toLowerCase()} →</button><button type="button" data-score-action="cursor" aria-pressed="true">${copy.cursor}</button>`;
    controls.querySelector('[data-score-action="zoom-out"]')?.addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.1); osmd.Zoom = zoom; osmd.render(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="zoom-in"]')?.addEventListener("click", () => { zoom = Math.min(1.8, zoom + 0.1); osmd.Zoom = zoom; osmd.render(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="prev-page"]')?.addEventListener("click", () => { page -= 1; showPage(); });
    controls.querySelector('[data-score-action="next-page"]')?.addEventListener("click", () => { page += 1; showPage(); });
    controls.querySelector<HTMLSelectElement>("[data-score-layout]")?.addEventListener("change", (event) => { pageMode = (event.currentTarget as HTMLSelectElement).value === "page"; showPage(); });
    controls.querySelector('[data-score-action="prev-measure"]')?.addEventListener("click", () => { try { osmd.cursor.previous(); measure = Math.max(1, measure - 1); } catch { measure = 1; } controls.querySelector<HTMLElement>("[data-measure-label]")!.textContent = `${copy.measure} ${measure}`; });
    controls.querySelector('[data-score-action="next-measure"]')?.addEventListener("click", () => { try { osmd.cursor.next(); measure += 1; } catch { /* Cursor stays at the final measure. */ } controls.querySelector<HTMLElement>("[data-measure-label]")!.textContent = `${copy.measure} ${measure}`; });
    controls.querySelector<HTMLButtonElement>('[data-score-action="cursor"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const visible = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(visible));
      if (visible) osmd.cursor.show(); else osmd.cursor.hide();
    });
    showPage();
    status.textContent = copy.loaded;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : copy.scoreFailed;
  } else { status.textContent = copy.notationUnavailable; canvas.hidden = true; controls.hidden = true; }

  if (!shouldMountStandaloneMidi(options)) {
    midiControls.hidden = true;
    piano.hidden = true;
    return () => cleanups.splice(0).forEach((cleanup) => cleanup());
  }

  const midiUrl = root.dataset.midiUrl;
  if (!midiUrl) {
    midiControls.innerHTML = `<p>${copy.midiUnavailable}</p>`;
    return () => cleanups.splice(0).forEach((cleanup) => cleanup());
  }
  const pianoVisualizer = new PianoVisualizer(piano);
  pianoVisualizer.mount();
  const midi = new MidiPlayback((notes) => pianoVisualizer.setActiveNotes(notes), (position, duration) => {
    const progress = midiControls.querySelector<HTMLInputElement>("[data-midi-progress]");
    if (progress) { progress.max = String(duration); progress.value = String(position); }
  });
  cleanups.push(() => { midi.destroy(); pianoVisualizer.clear(); piano.replaceChildren(); });
  midiControls.innerHTML = `<div class="midi-transport"><button type="button" data-midi-action="play">▶ ${copy.playPause}</button><button type="button" data-midi-action="stop">■ ${copy.stop}</button><label>${copy.tempo} <input data-midi-tempo type="range" min="50" max="150" value="100" /><output>100%</output></label><button type="button" data-midi-action="metronome" aria-pressed="false">${copy.metronome}</button></div><label class="midi-progress">${copy.position} <input data-midi-progress type="range" min="0" max="0" value="0" step="0.01" disabled /></label><div class="midi-loop"><label>A (${copy.seconds}) <input data-loop-a type="number" min="0" step="0.1" /></label><label>B (${copy.seconds}) <input data-loop-b type="number" min="0" step="0.1" /></label><button type="button" data-midi-action="loop">${copy.setLoop}</button><button type="button" data-midi-action="clear-loop">${copy.clearLoop}</button></div>`;
  try {
    await midi.load(midiUrl, Number(root.dataset.bpm) || 120);
    const progress = midiControls.querySelector<HTMLInputElement>("[data-midi-progress]");
    enableMidiSeek(progress);
    progress?.addEventListener("input", () => midi.seek(Number(progress.value)));
    midiControls.querySelector('[data-midi-action="play"]')?.addEventListener("click", () => midi.isPlaying() ? midi.pause() : void midi.play());
    midiControls.querySelector('[data-midi-action="stop"]')?.addEventListener("click", () => midi.stop());
    midiControls.querySelector<HTMLInputElement>("[data-midi-tempo]")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      midi.setTempo(Number(input.value));
      input.nextElementSibling!.textContent = `${input.value}%`;
    });
    midiControls.querySelector<HTMLButtonElement>('[data-midi-action="metronome"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const enabled = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(enabled));
      midi.setMetronome(enabled);
    });
    midiControls.querySelector('[data-midi-action="loop"]')?.addEventListener("click", () => midi.setLoop(Number(midiControls.querySelector<HTMLInputElement>("[data-loop-a]")?.value) || 0, Number(midiControls.querySelector<HTMLInputElement>("[data-loop-b]")?.value) || null));
    midiControls.querySelector('[data-midi-action="clear-loop"]')?.addEventListener("click", () => midi.setLoop(null, null));
  } catch (error) {
    midiControls.innerHTML = `<p>${error instanceof Error ? error.message : copy.midiFailed}</p>`;
  }
  return () => cleanups.splice(0).forEach((cleanup) => cleanup());
}
