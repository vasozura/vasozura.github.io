import { MidiPlayback } from "./midi-playback";
import { PianoVisualizer } from "./instrument-visualizer";

export async function mountScoreViewer(root: HTMLElement): Promise<void> {
  const musicXmlUrl = root.dataset.musicxmlUrl;
  if (!musicXmlUrl) return;
  const canvas = root.querySelector<HTMLElement>(".score-canvas");
  const controls = root.querySelector<HTMLElement>(".score-controls");
  const status = root.querySelector<HTMLElement>(".score-status");
  const midiControls = root.querySelector<HTMLElement>(".midi-controls");
  const piano = root.querySelector<HTMLElement>(".piano-keyboard");
  if (!canvas || !controls || !status || !midiControls || !piano) return;

  try {
    const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
    const osmd = new OpenSheetMusicDisplay(canvas, { autoResize: true, backend: "svg", drawTitle: true, followCursor: true });
    await osmd.load(musicXmlUrl);
    osmd.render();
    osmd.cursor.show();
    let zoom = 1;
    let page = 0;
    const pages = () => [...canvas.querySelectorAll<HTMLElement>(".osmd-page")];
    const showPage = (): void => {
      const list = pages();
      if (list.length <= 1) return;
      page = Math.max(0, Math.min(page, list.length - 1));
      list.forEach((entry, index) => { entry.hidden = index !== page; });
      controls.querySelector<HTMLElement>("[data-page-label]")!.textContent = `${page + 1} / ${list.length}`;
    };
    controls.innerHTML = `<button type="button" data-score-action="zoom-out" aria-label="Zoom out">−</button><output data-zoom-label>100%</output><button type="button" data-score-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-score-action="prev-page" aria-label="Previous page">←</button><output data-page-label>1 / ${Math.max(1, pages().length)}</output><button type="button" data-score-action="next-page" aria-label="Next page">→</button><button type="button" data-score-action="cursor" aria-pressed="true">Cursor</button>`;
    controls.querySelector('[data-score-action="zoom-out"]')?.addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.1); osmd.Zoom = zoom; osmd.render(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="zoom-in"]')?.addEventListener("click", () => { zoom = Math.min(1.8, zoom + 0.1); osmd.Zoom = zoom; osmd.render(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="prev-page"]')?.addEventListener("click", () => { page -= 1; showPage(); });
    controls.querySelector('[data-score-action="next-page"]')?.addEventListener("click", () => { page += 1; showPage(); });
    controls.querySelector<HTMLButtonElement>('[data-score-action="cursor"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const visible = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(visible));
      if (visible) osmd.cursor.show(); else osmd.cursor.hide();
    });
    showPage();
    status.textContent = "MusicXML score loaded.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The score could not be loaded.";
  }

  const midiUrl = root.dataset.midiUrl;
  if (!midiUrl) { midiControls.innerHTML = "<p>MIDI playback is not available for this score.</p>"; return; }
  const pianoVisualizer = new PianoVisualizer(piano);
  pianoVisualizer.mount();
  const midi = new MidiPlayback((notes) => pianoVisualizer.setActiveNotes(notes), (position, duration) => {
    const progress = midiControls.querySelector<HTMLInputElement>("[data-midi-progress]");
    if (progress) { progress.max = String(duration); progress.value = String(position); }
  });
  midiControls.innerHTML = `<div class="midi-transport"><button type="button" data-midi-action="play">▶ Play / pause</button><button type="button" data-midi-action="stop">■ Stop</button><label>Tempo <input data-midi-tempo type="range" min="50" max="150" value="100" /><output>100%</output></label><button type="button" data-midi-action="metronome" aria-pressed="false">Metronome</button></div><label class="midi-progress">Position <input data-midi-progress type="range" min="0" max="0" value="0" step="0.01" disabled /></label><div class="midi-loop"><label>A (seconds) <input data-loop-a type="number" min="0" step="0.1" /></label><label>B (seconds) <input data-loop-b type="number" min="0" step="0.1" /></label><button type="button" data-midi-action="loop">Set A–B loop</button><button type="button" data-midi-action="clear-loop">Clear loop</button></div>`;
  try {
    await midi.load(midiUrl, Number(root.dataset.bpm) || 120);
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
    midiControls.innerHTML = `<p>${error instanceof Error ? error.message : "MIDI could not be loaded."}</p>`;
  }
}
