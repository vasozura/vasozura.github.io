import { getInitialLanguage, type Language } from "../i18n";
import { MidiPlayback } from "./midi-playback";
import { PianoVisualizer } from "./instrument-visualizer";
import { playbackCoordinator } from "../audio/playback-coordinator";
import { clientToScorePoint, learningMarkerTarget, logicalPageState, nearestScorePosition, scoreClickRatio, type LearningMarkerRequest, type ScoreCoordinateTransform, type ScoreMeasureTarget, type ScorePositionRequest } from "./score-navigation";

interface GraphicalEntryLike {
  PositionAndShape?: { AbsolutePosition?: { x: number; y: number }; BorderLeft?: number; BorderRight?: number; BorderTop?: number; BorderBottom?: number; Size?: { width?: number; height?: number } };
  relInMeasureTimestamp?: { RealValue?: number };
  graphicalChordContainers?: Array<{ GraphicalLabel?: { Label?: { text?: string } } }>;
  graphicalVoiceEntries?: Array<{ notes?: Array<{ sourceNote?: { halfTone?: number } }> }>;
}
interface GraphicalMeasureLike {
  PositionAndShape?: { AbsolutePosition?: { x: number; y: number }; BorderLeft?: number; BorderRight?: number; BorderTop?: number; BorderBottom?: number; Size?: { width?: number; height?: number } };
  parentSourceMeasure?: { measureListIndex?: number; Duration?: { RealValue?: number } };
  ParentMusicSystem?: { Parent?: { PositionAndShape?: { AbsolutePosition?: { x: number; y: number } } } };
  staffEntries?: GraphicalEntryLike[];
}

export function scoreTargetsFromGraphicalMeasures(measureList: GraphicalMeasureLike[][]): { targets: ScoreMeasureTarget[]; harmonies: Array<{ measureIndex: number; relativePosition: number; label: string }> } {
  const targets: ScoreMeasureTarget[] = [];
  const harmonies: Array<{ measureIndex: number; relativePosition: number; label: string }> = [];
  for (const measureRow of measureList) for (const [staffIndex, measure] of measureRow.entries()) {
    const box = measure.PositionAndShape;
    const position = box?.AbsolutePosition;
    const measureIndex = measure.parentSourceMeasure?.measureListIndex;
    if (!position || measureIndex == null) continue;
    const duration = measure.parentSourceMeasure?.Duration?.RealValue || 1;
    const entries = (measure.staffEntries ?? []).map((entry) => {
      const shape = entry.PositionAndShape;
      const point = shape?.AbsolutePosition ?? position;
      return {
        x: point.x,
        y: point.y,
        left: point.x + (shape?.BorderLeft ?? -0.75),
        right: point.x + (shape?.BorderRight ?? shape?.Size?.width ?? 0.75),
        top: point.y + (shape?.BorderTop ?? -4),
        bottom: point.y + (shape?.BorderBottom ?? shape?.Size?.height ?? 4),
        relativePosition: Math.max(0, Math.min(1, (entry.relInMeasureTimestamp?.RealValue ?? 0) / duration)),
        sourceTimestamp: entry.relInMeasureTimestamp?.RealValue ?? 0,
        midi: entry.graphicalVoiceEntries?.flatMap((voice) => voice.notes ?? []).map((note) => note.sourceNote?.halfTone).find((value): value is number => Number.isFinite(value)),
      };
    });
    for (const entry of measure.staffEntries ?? []) for (const chord of entry.graphicalChordContainers ?? []) {
      const label = chord.GraphicalLabel?.Label?.text?.trim();
      if (label) harmonies.push({ measureIndex, relativePosition: Math.max(0, Math.min(1, (entry.relInMeasureTimestamp?.RealValue ?? 0) / duration)), label });
    }
    targets.push({
      measureIndex,
      staffIndex,
      left: position.x + (box?.BorderLeft ?? 0),
      right: position.x + (box?.BorderRight ?? box?.Size?.width ?? 1),
      top: position.y + (box?.BorderTop ?? 0),
      bottom: position.y + (box?.BorderBottom ?? box?.Size?.height ?? 1),
      entries,
    });
  }
  return { targets, harmonies: harmonies.filter((item, index) => !harmonies.slice(0, index).some((seen) => seen.measureIndex === item.measureIndex && seen.relativePosition === item.relativePosition && seen.label === item.label)) };
}

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
export const scoreWidthChanged = (previous: number, next: number): boolean => previous <= 0 || Math.abs(previous - next) >= 8;
export const osmdViewerOptions = { autoResize: false, backend: "svg", drawTitle: true, followCursor: false } as const;

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
  const surface = root.querySelector<HTMLElement>(".score-render-surface") ?? canvas;
  const controls = root.querySelector<HTMLElement>(".score-controls");
  const status = root.querySelector<HTMLElement>(".score-status");
  const midiControls = root.querySelector<HTMLElement>(".midi-controls");
  const piano = root.querySelector<HTMLElement>(".piano-keyboard");
  if (!canvas || !surface || !controls || !status || !midiControls || !piano) return () => {};

  if (musicXmlUrl) try {
    const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
    const osmd = new OpenSheetMusicDisplay(surface, osmdViewerOptions);
    await osmd.load(await fetchScoreSource(musicXmlUrl));
    let scoreTargets: ScoreMeasureTarget[] = [];
    let learningMarker: HTMLSpanElement | null = null;
    let renderFrame = 0;
    let lastWidth = surface.clientWidth;
    const renderScore = (): void => {
      window.cancelAnimationFrame(renderFrame);
      const stableHeight = Math.max(canvas.clientHeight, 320);
      const previousTop = canvas.scrollTop;
      const previousLeft = canvas.scrollLeft;
      const previousScrollableHeight = Math.max(1, canvas.scrollHeight - canvas.clientHeight);
      const previousScrollableWidth = Math.max(1, canvas.scrollWidth - canvas.clientWidth);
      canvas.style.setProperty("--score-stable-height", `${stableHeight}px`);
      canvas.classList.add("is-rendering");
      osmd.render();
      if (learningMarker && !learningMarker.isConnected) surface.append(learningMarker);
      const graphical = (osmd as unknown as { GraphicSheet?: { MeasureList?: GraphicalMeasureLike[][] } }).GraphicSheet?.MeasureList ?? [];
      const mapped = scoreTargetsFromGraphicalMeasures(graphical);
      scoreTargets = mapped.targets;
      root.dataset.scoreHarmonies = JSON.stringify(mapped.harmonies);
      renderFrame = window.requestAnimationFrame(() => {
        canvas.scrollTop = previousScrollableHeight > 1
          ? previousTop / previousScrollableHeight * Math.max(0, canvas.scrollHeight - canvas.clientHeight)
          : previousTop;
        canvas.scrollLeft = previousScrollableWidth > 1
          ? previousLeft / previousScrollableWidth * Math.max(0, canvas.scrollWidth - canvas.clientWidth)
          : previousLeft;
        canvas.classList.remove("is-rendering");
        showPage();
      });
    };
    renderScore();
    const dedicatedLearningMarker = root.dataset.learningEnabled === "true";
    if (dedicatedLearningMarker) osmd.cursor.hide(); else osmd.cursor.show();
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
    let measure = 1;
    let pageMode = true;
    const showPage = (): void => {
      surface.querySelectorAll<HTMLElement>(".osmd-page").forEach((entry) => { entry.hidden = false; });
      canvas.dataset.scoreLayout = pageMode ? "page" : "continuous";
      const state = logicalPageState(canvas.scrollTop, canvas.clientHeight, surface.scrollHeight);
      const group = controls.querySelector<HTMLElement>("[data-score-pages]");
      if (group) group.hidden = !pageMode;
      const label = controls.querySelector<HTMLElement>("[data-page-label]");
      if (label) label.textContent = `${state.index + 1} / ${state.count}`;
    };
    const changePage = (delta: number): void => {
      const state = logicalPageState(canvas.scrollTop, canvas.clientHeight, surface.scrollHeight);
      const index = Math.max(0, Math.min(state.count - 1, state.index + delta));
      canvas.scrollTo({ top: index * canvas.clientHeight, left: canvas.scrollLeft });
      showPage();
    };
    controls.innerHTML = `<div class="score-control-group"><button type="button" data-score-action="zoom-out" aria-label="${copy.zoomOut}">−</button><output data-zoom-label>100%</output><button type="button" data-score-action="zoom-in" aria-label="${copy.zoomIn}">+</button></div><div class="score-control-group"><label>${copy.layout} <select data-score-layout><option value="page">${copy.page}</option><option value="continuous">${copy.continuous}</option></select></label><button type="button" data-score-action="cursor" aria-pressed="true">${copy.cursor}</button></div><div class="score-control-group" data-score-pages><button type="button" data-score-action="prev-page" aria-label="${copy.previousPage}">← ${copy.page.toLowerCase()}</button><output data-page-label>1 / 1</output><button type="button" data-score-action="next-page" aria-label="${copy.nextPage}">${copy.page.toLowerCase()} →</button></div><div class="score-control-group"><button type="button" data-score-action="prev-measure" aria-label="${copy.previousMeasure}">← ${copy.measure.toLowerCase()}</button><output data-measure-label>${copy.measure} 1</output><button type="button" data-score-action="next-measure" aria-label="${copy.nextMeasure}">${copy.measure.toLowerCase()} →</button></div>`;
    if (dedicatedLearningMarker) controls.querySelector<HTMLElement>('[data-score-action="cursor"]')!.hidden = true;
    controls.querySelector('[data-score-action="zoom-out"]')?.addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.1); osmd.Zoom = zoom; renderScore(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="zoom-in"]')?.addEventListener("click", () => { zoom = Math.min(1.8, zoom + 0.1); osmd.Zoom = zoom; renderScore(); controls.querySelector<HTMLElement>("[data-zoom-label]")!.textContent = `${Math.round(zoom * 100)}%`; showPage(); });
    controls.querySelector('[data-score-action="prev-page"]')?.addEventListener("click", () => changePage(-1));
    controls.querySelector('[data-score-action="next-page"]')?.addEventListener("click", () => changePage(1));
    controls.querySelector<HTMLSelectElement>("[data-score-layout]")?.addEventListener("change", (event) => { pageMode = (event.currentTarget as HTMLSelectElement).value === "page"; showPage(); });
    controls.querySelector('[data-score-action="prev-measure"]')?.addEventListener("click", () => { try { osmd.cursor.previous(); measure = Math.max(1, measure - 1); } catch { measure = 1; } controls.querySelector<HTMLElement>("[data-measure-label]")!.textContent = `${copy.measure} ${measure}`; });
    controls.querySelector('[data-score-action="next-measure"]')?.addEventListener("click", () => { try { osmd.cursor.next(); measure += 1; } catch { /* Cursor stays at the final measure. */ } controls.querySelector<HTMLElement>("[data-measure-label]")!.textContent = `${copy.measure} ${measure}`; });
    controls.querySelector<HTMLButtonElement>('[data-score-action="cursor"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const visible = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(visible));
      if (visible) osmd.cursor.show(); else osmd.cursor.hide();
    });
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? surface.clientWidth;
        if (!scoreWidthChanged(lastWidth, width)) return;
        lastWidth = width;
        window.cancelAnimationFrame(renderFrame);
        renderFrame = window.requestAnimationFrame(() => { renderScore(); showPage(); });
      });
      observer.observe(surface);
      cleanups.push(() => observer.disconnect());
    }
    const updatePageOnScroll = (): void => showPage();
    canvas.addEventListener("scroll", updatePageOnScroll, { passive: true });
    cleanups.push(() => canvas.removeEventListener("scroll", updatePageOnScroll));
    const sheet = (osmd as unknown as { GraphicSheet: ScoreCoordinateTransform & { svgToDom(point: { x: number; y: number }): { x: number; y: number } }; Sheet?: { SourceMeasures?: unknown[] } }).GraphicSheet;
    const pointerDebug = import.meta.env.DEV && new URLSearchParams(window.location.search).has("scorePointerDebug");
    let debugOverlay: HTMLElement | null = null;
    let debugTimer = 0;
    const osmdToClient = (point: { x: number; y: number }): { x: number; y: number } => sheet.svgToDom({ x: point.x * 10, y: point.y * 10 });
    learningMarker = document.createElement("span");
    learningMarker.className = "learning-note-marker";
    learningMarker.setAttribute("aria-hidden", "true");
    surface.append(learningMarker);
    const moveLearningMarker = (event: Event): void => {
      const marker = learningMarker;
      if (!marker) return;
      const request = (event as CustomEvent<LearningMarkerRequest>).detail;
      const resolved = learningMarkerTarget(request, scoreTargets);
      if (!resolved) return;
      const client = osmdToClient({ x: resolved.entry.x, y: resolved.entry.y });
      const surfaceRect = surface.getBoundingClientRect();
      marker.style.left = `${client.x - surfaceRect.left}px`;
      marker.style.top = `${client.y - surfaceRect.top}px`;
      marker.dataset.noteId = request.noteId;
      marker.dataset.measure = String(request.measureIndex + 1);
      marker.dataset.staff = String(resolved.measure.staffIndex + 1);
      marker.classList.add("is-visible");
      const canvasRect = canvas.getBoundingClientRect();
      const margin = 48;
      if (client.y < canvasRect.top + margin || client.y > canvasRect.bottom - margin) {
        const targetY = canvas.scrollTop + client.y - (canvasRect.top + canvasRect.height / 2);
        canvas.scrollTo({ top: Math.max(0, targetY), left: canvas.scrollLeft, behavior: "smooth" });
      }
    };
    root.addEventListener("learning-marker-request", moveLearningMarker);
    cleanups.push(() => { root.removeEventListener("learning-marker-request", moveLearningMarker); learningMarker?.remove(); learningMarker = null; });
    const showPointerDebug = (event: MouseEvent, detail: ScorePositionRequest): void => {
      if (!pointerDebug || !detail.target) return;
      window.clearTimeout(debugTimer);
      debugOverlay?.remove();
      const surfaceRect = surface.getBoundingClientRect();
      const overlay = document.createElement("div");
      overlay.className = "score-pointer-debug";
      overlay.dataset.measure = String(detail.measureIndex + 1);
      overlay.dataset.staff = String((detail.staffIndex ?? 0) + 1);
      const measureBox = document.createElement("span");
      measureBox.className = "score-pointer-measure";
      const measureStart = osmdToClient({ x: detail.target.left, y: detail.target.top });
      const measureEnd = osmdToClient({ x: detail.target.right, y: detail.target.bottom });
      Object.assign(measureBox.style, { left: `${measureStart.x - surfaceRect.left}px`, top: `${measureStart.y - surfaceRect.top}px`, width: `${Math.max(1, measureEnd.x - measureStart.x)}px`, height: `${Math.max(1, measureEnd.y - measureStart.y)}px` });
      const crosshair = document.createElement("span");
      crosshair.className = "score-pointer-crosshair";
      Object.assign(crosshair.style, { left: `${event.clientX - surfaceRect.left}px`, top: `${event.clientY - surfaceRect.top}px` });
      const selectedEntry = detail.entryIndex == null ? null : detail.target.entries[detail.entryIndex];
      const entryMarker = document.createElement("span");
      entryMarker.className = "score-pointer-entry";
      if (selectedEntry) {
        const entryStart = osmdToClient({ x: selectedEntry.left, y: selectedEntry.top });
        const entryEnd = osmdToClient({ x: selectedEntry.right, y: selectedEntry.bottom });
        Object.assign(entryMarker.style, { left: `${entryStart.x - surfaceRect.left}px`, top: `${entryStart.y - surfaceRect.top}px`, width: `${Math.max(4, entryEnd.x - entryStart.x)}px`, height: `${Math.max(4, entryEnd.y - entryStart.y)}px` });
      }
      const label = document.createElement("output");
      label.className = "score-pointer-label";
      label.textContent = `Measure ${detail.measureIndex + 1} · Staff ${(detail.staffIndex ?? 0) + 1} · Beat ${(1 + (detail.sourceTimestamp ?? detail.relativePosition) * 4).toFixed(2)} · MIDI ${detail.midi ?? "—"} · resolving…`;
      overlay.append(measureBox, entryMarker, crosshair, label);
      surface.append(overlay);
      debugOverlay = overlay;
      debugTimer = window.setTimeout(() => { overlay.remove(); if (debugOverlay === overlay) debugOverlay = null; }, 3500);
    };
    const updatePointerDebug = (event: Event): void => {
      const detail = (event as CustomEvent<{ seconds?: number; noteId?: string | null }>).detail;
      const label = debugOverlay?.querySelector<HTMLOutputElement>(".score-pointer-label");
      if (label && Number.isFinite(detail?.seconds)) label.textContent = `${label.textContent?.replace(/ · resolving…$/, "")} · ${detail.seconds!.toFixed(3)}s · ${detail.noteId ?? "measure"}`;
    };
    root.addEventListener("score-pointer-resolved", updatePointerDebug);
    cleanups.push(() => { root.removeEventListener("score-pointer-resolved", updatePointerDebug); window.clearTimeout(debugTimer); debugOverlay?.remove(); });
    const seekFromScore = (event: MouseEvent): void => {
      let detail: ScorePositionRequest | null = null;
      if (scoreTargets.length) {
        const point = clientToScorePoint(event.clientX, event.clientY, sheet);
        detail = nearestScorePosition(point.x, point.y, scoreTargets);
      }
      if (!detail) {
        console.warn("OSMD graphical hit targets unavailable; using emergency approximate score seeking.");
        const ratio = scoreClickRatio(event, surface);
        const sourceMeasureCount = Math.max(1, (osmd as unknown as { Sheet?: { SourceMeasures?: unknown[] } }).Sheet?.SourceMeasures?.length ?? Number(root.dataset.measureCount) ?? 1);
        const position = ratio * sourceMeasureCount;
        detail = { measureIndex: Math.min(sourceMeasureCount - 1, Math.floor(position)), relativePosition: position % 1 };
      }
      showPointerDebug(event, detail);
      root.dispatchEvent(new CustomEvent<ScorePositionRequest>("score-position-request", { detail }));
    };
    surface.addEventListener("click", seekFromScore);
    cleanups.push(() => surface.removeEventListener("click", seekFromScore));
    cleanups.push(() => window.cancelAnimationFrame(renderFrame));
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
  const transportId = `score-${root.dataset.songId || crypto.randomUUID()}`;
  const unregisterTransport = playbackCoordinator.register(transportId, midi);
  const seekFromScore = (event: Event): void => {
    const detail = (event as CustomEvent<ScorePositionRequest>).detail;
    if (Number.isInteger(detail?.measureIndex) && Number.isFinite(detail.relativePosition)) {
      playbackCoordinator.activate(transportId);
      const measureCount = Math.max(1, Number(root.dataset.measureCount) || 1);
      midi.seek(Math.max(0, Math.min(1, (detail.measureIndex + detail.relativePosition) / measureCount)) * midi.getDuration());
    }
  };
  root.addEventListener("score-position-request", seekFromScore);
  cleanups.push(() => { unregisterTransport(); root.removeEventListener("score-position-request", seekFromScore); midi.destroy(); pianoVisualizer.clear(); piano.replaceChildren(); });
  midiControls.innerHTML = `<div class="midi-transport"><button type="button" data-midi-action="play">▶ ${copy.playPause}</button><button type="button" data-midi-action="stop">■ ${copy.stop}</button><label>${copy.tempo} <input data-midi-tempo type="range" min="50" max="150" value="100" /><output>100%</output></label><button type="button" data-midi-action="metronome" aria-pressed="false">${copy.metronome}</button></div><label class="midi-progress">${copy.position} <input data-midi-progress type="range" min="0" max="0" value="0" step="0.01" disabled /></label><div class="midi-loop"><label>A (${copy.seconds}) <input data-loop-a type="number" min="0" step="0.1" /></label><label>B (${copy.seconds}) <input data-loop-b type="number" min="0" step="0.1" /></label><button type="button" data-midi-action="loop">${copy.setLoop}</button><button type="button" data-midi-action="clear-loop">${copy.clearLoop}</button></div>`;
  try {
    await midi.load(midiUrl, Number(root.dataset.bpm) || 120);
    const progress = midiControls.querySelector<HTMLInputElement>("[data-midi-progress]");
    enableMidiSeek(progress);
    progress?.addEventListener("input", () => midi.seek(Number(progress.value)));
    midiControls.querySelector('[data-midi-action="play"]')?.addEventListener("click", () => midi.isPlaying() ? playbackCoordinator.pause(transportId) : void playbackCoordinator.play(transportId));
    midiControls.querySelector('[data-midi-action="stop"]')?.addEventListener("click", () => playbackCoordinator.stop(transportId));
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
