import { appConfig } from "../config";
import { getInitialLanguage } from "../i18n";
import { getSupabase } from "../lib/supabase";
import { mountScoreViewer } from "../score/score-viewer";
import type { AttemptResult, Exercise, ExerciseSelection, NoteEvent, ScoreManifest, Timeline } from "./contracts";
import { isLearningApiUnavailable, LearningApiClient, type LearningApi } from "./api-client";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { isVerifiedAccordionConfig, type TimelineVisualizer } from "./instruments";
import { LocalLearningApi } from "./mock-api";
import { MidiAttemptRecorder } from "./practice";
import { CanonicalScheduler, type SchedulerFrame } from "./scheduler";
import { assessSynchronization, readMidiDuration } from "./sync-analysis";
import { connectWebMidi, supportsWebMidi } from "./web-midi";
import { getLearningCopy } from "./copy";
import { playbackCoordinator } from "../audio/playback-coordinator";
import { resolveCanonicalScoreLocation, type ScorePositionRequest } from "../score/score-navigation";
import { hasExplicitStaffIdentity, type PlaybackMode, type StaffScope } from "./playback-selection";
import { buildVoiceLanes, laneInScope, selectMelodyLane } from "./voice-lanes";
import { createActiveMelodyTimeline } from "./active-melody";
import { activeHarmonyAt, buildHarmonicTimeline, type ExplicitHarmony } from "./harmony";
import { SampleInstrumentEngine, type InstrumentName } from "../audio/sample-instrument";
import { guitarCandidates } from "./instruments";
import type { ChordPatternName, PatternRate } from "./chord-patterns";

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteLabel = (midi: number): string => `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected learning error.";
  const message = error.message;
  if (/401|403|auth|bearer|access.?token|jwt/i.test(message)) return "Authentication is required for this action.";
  if (/timeout|network|fetch|reach/i.test(message)) return `Network: ${message}`;
  if (/parse|musicxml|midi/i.test(message)) return `Source parsing: ${message}`;
  return message;
}

export const canUseProtectedLearningApi = (usingLocalAdapter: boolean, hasSession: boolean): boolean => usingLocalAdapter || hasSession;

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

async function manifestFromMidi(songId: string, url: string): Promise<ScoreManifest> {
  const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), fetch(url)]);
  if (!response.ok) throw new Error(`MIDI unavailable (${response.status})`);
  const midi = new Midi(await response.arrayBuffer());
  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const measureLength = 60 / bpm * 4;
  const notes: NoteEvent[] = midi.tracks.flatMap((track, trackIndex) => track.notes.map((note, noteIndex): NoteEvent => ({ id: `t${trackIndex}n${noteIndex}`, partId: `track-${trackIndex}`, measureIndex: Math.max(0, Math.floor(note.time / measureLength)), beat: 1 + note.time % measureLength / (measureLength / 4), startSeconds: note.time, durationSeconds: note.duration, midi: note.midi, velocity: note.velocity, hand: "unknown" }))).sort((a, b) => a.startSeconds - b.startSeconds).map((note, cursorStep) => ({ ...note, cursorStep }));
  const count = Math.max(1, Math.ceil(midi.duration / measureLength));
  const timeline: Timeline = { version: "v1", durationSeconds: midi.duration, notes, tempos: [{ atSeconds: 0, bpm, measureIndex: 0 }], timeSignatures: [{ atSeconds: 0, beats: 4, beatType: 4, measureIndex: 0 }], measures: Array.from({ length: count }, (_, index) => ({ index, number: String(index + 1), startSeconds: index * measureLength, durationSeconds: Math.min(measureLength, Math.max(0, midi.duration - index * measureLength)), beats: 4, beatType: 4, pickup: false })) };
  return { version: "v1", songId, sourceChecksum: "local-midi", generatedAt: new Date(0).toISOString(), parts: midi.tracks.map((track, index) => ({ id: `track-${index}`, name: track.name || `Track ${index + 1}`, instrument: track.instrument.name, midiChannel: track.channel, hand: "unknown" })), timeline, warnings: ["Local deterministic MIDI adapter; backend analysis unavailable."] };
}

function resultText(result: AttemptResult, copy: ReturnType<typeof getLearningCopy>): string {
  return `${copy.pitch} ${Math.round(result.pitchScore)}% · ${copy.timing} ${Math.round(result.timingScore)}% · ${copy.completion} ${Math.round(result.completion)}% · ${copy.streak} ${result.streak}`;
}

async function countdown(beats: number, beatDurationMs: number, output: HTMLElement, signal: AbortSignal, startingIn: string): Promise<void> {
  for (let remaining = beats; remaining > 0; remaining -= 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    output.textContent = `${startingIn} ${remaining}…`;
    await new Promise<void>((resolve) => window.setTimeout(resolve, beatDurationMs));
  }
}

export async function mountLearningMode(root: HTMLElement): Promise<() => void> {
  const copy = getLearningCopy(getInitialLanguage());
  const scoreCleanup = await mountScoreViewer(root, { midiPlayback: false });
  const midiUrl = root.dataset.midiUrl;
  const songId = root.dataset.songId ?? "";
  if (root.dataset.learningEnabled !== "true" || !songId || (!appConfig.hasLearningApi && !midiUrl)) return scoreCleanup;

  const allowed = new Set((root.dataset.learningInstruments || "piano").split(",").filter(Boolean));
  const host = document.createElement("section");
  host.className = "learning-mode";
  host.setAttribute("aria-labelledby", "learning-mode-title");
  host.innerHTML = `
    <h3 id="learning-mode-title">${copy.title}</h3>
    <p class="learning-clock-note">${copy.clock}</p>
    <p data-l="sync" class="learning-sync" aria-live="polite">${copy.checking}</p>
    <div class="learning-transport">
      <div class="learning-transport-row learning-transport-primary">
        <button type="button" data-l="play">${copy.play}</button><button type="button" data-l="pause">${copy.pause}</button><button type="button" data-l="stop">${copy.stop}</button>
        <button type="button" data-l="metronome" aria-pressed="false">${copy.metronome}</button>
        <div class="learning-transport-metrics"><label><span>${copy.tempo}</span><input data-l="tempo" type="range" min="50" max="150" value="100"><output data-l="tempo-value">100%</output></label><label><span>${copy.position}</span><input data-l="seek" type="range" min="0" max="0" value="0" step="0.01"><output data-l="time-value">00:00 / 00:00</output></label><output data-l="position">${copy.measure} 1 · ${copy.beat} 1</output></div>
      </div>
      <div class="learning-transport-row learning-transport-secondary">
        <label>${copy.loopFrom} <input data-l="loop-a" type="number" min="1" value="1"></label>
        <label>${copy.to} <input data-l="loop-b" type="number" min="1" value="1"></label>
        <button type="button" data-l="loop">${copy.setLoop}</button><button type="button" data-l="clear-loop">${copy.clearLoop}</button>
        <label>${copy.playbackMode} <select data-l="playback-mode"><option value="chords">${copy.chords}</option><option value="solo">${copy.solo}</option></select></label>
        <label>${copy.staffScope} <select data-l="staff-scope"><option value="both">${copy.both}</option><option value="treble">${copy.treble}</option><option value="bass">${copy.bass}</option></select></label>
        <label data-l="pattern-control">${copy.pattern} <select data-l="chord-pattern"><option value="block">${copy.block}</option><option value="bass-12321">Bass · 1 2 3 2 1</option><option value="bass-123-bass-123">Bass · 1 2 3 · Bass · 1 2 3</option><option value="bass-1323">Bass · 1 3 2 3</option><option value="bass-321">Bass · 3 2 1</option><option value="up">Up</option><option value="down">Down</option><option value="up-down">Up / Down</option><option value="alberti">Alberti</option></select></label>
        <label data-l="rate-control">${copy.rate} <select data-l="chord-rate"><option value="1/4">1/4</option><option value="1/8" selected>1/8</option><option value="1/16">1/16</option></select></label>
      </div>
      <div class="learning-vocal-controls" data-l="vocal-controls">
        <label class="learning-vocal-quick"><input type="checkbox" data-l="melody"> <strong>${copy.vocalMelody}</strong></label>
        <fieldset data-l="timing"><legend>${copy.timing}</legend><label><input type="radio" name="learning-timing" value="original" checked> ${copy.original}</label><label><input type="radio" name="learning-timing" value="active"> ${copy.active}</label></fieldset>
        <label>${copy.restThreshold} <input data-l="rest-threshold" type="number" min="0.3" max="5" step="0.1" value="0.6"> s</label>
        <label>${copy.activeGap} <input data-l="active-gap" type="number" min="0.05" max="0.5" step="0.05" value="0.2"> s</label>
        <label>${copy.melodySound} <select data-l="melody-sound">${allowed.has("piano") ? `<option value="piano">${copy.piano}</option>` : ""}${allowed.has("guitar") ? `<option value="guitar">${copy.guitar}</option>` : ""}</select></label>
      </div>
      <details class="learning-voice-picker"><summary>${copy.sourceVoices}</summary><div data-l="voice-list"></div></details>
      <p data-l="staff-evidence" class="learning-staff-evidence" hidden>${copy.inferredStaff}</p>
    </div>
    <div class="learning-instruments" role="tablist" aria-label="${copy.instrumentView}">
      ${allowed.has("piano") ? `<button type="button" role="tab" data-instrument="piano">${copy.piano}</button>` : ""}
      ${allowed.has("guitar") ? `<button type="button" role="tab" data-instrument="guitar">${copy.guitar}</button>` : ""}
      ${allowed.has("accordion") ? `<button type="button" role="tab" data-instrument="accordion">${copy.accordion}</button>` : ""}
    </div>
    <div class="learning-view-options"><label><input type="checkbox" data-l="follow"> ${copy.follow}</label><label data-l="left-label" hidden><input type="checkbox" data-l="left"> ${copy.leftHanded}</label></div>
    <p data-l="harmony" class="learning-harmony">${copy.currentChord}: —</p>
    <p data-l="pattern-status" class="learning-pattern-status" aria-live="polite">${copy.pattern}: ${copy.block} · ${copy.patternStep}: ${copy.block}</p>
    <p data-l="notes" class="learning-current">${copy.current}: — · ${copy.upcoming}: —</p>
    <div class="learning-visualizer-panel"><div data-l="visualizer" aria-live="off"></div></div>
    <section class="learning-practice" aria-labelledby="practice-title">
      <h4 id="practice-title">${copy.practice}</h4>
      <div class="learning-exercise-options">
        <label>${copy.instrument} <select data-l="exercise-instrument">${[...allowed].map((name) => `<option value="${name}">${name === "piano" ? copy.piano : name === "guitar" ? copy.guitar : copy.accordion}</option>`).join("")}</select></label>
        <label>${copy.fromMeasure} <input data-l="exercise-a" type="number" min="1" value="1"></label>
        <label>${copy.toMeasure} <input data-l="exercise-b" type="number" min="1" value="1"></label>
        <label>${copy.difficulty} <select data-l="difficulty"><option value="70">${copy.beginner}</option><option value="85">${copy.intermediate}</option><option value="100" selected>${copy.advanced}</option></select></label>
        <label>${copy.countdown} <select data-l="countdown"><option value="0">${copy.off}</option><option value="2">${copy.beats2}</option><option value="4" selected>${copy.beats4}</option></select></label>
        <label>${copy.practiceMode} <select data-l="practice-mode"><option value="listen">${copy.listen}</option><option value="wait-for-note">${copy.waitForNote}</option><option value="continuous" selected>${copy.continuous}</option></select></label>
      </div>
      <div class="learning-practice-actions"><button type="button" data-l="prepare">${copy.prepare}</button><button type="button" data-l="midi" ${supportsWebMidi() ? "" : "disabled"}>${copy.connectMidi}</button><button type="button" data-l="practice" disabled>${copy.startPractice}</button><button type="button" data-l="finish" disabled>${copy.finishScore}</button><button type="button" class="danger" data-l="reset">${copy.reset}</button><p data-l="practice-status" aria-live="polite"></p></div>
      <p class="learning-scoring">${copy.scoring}</p>
      <p data-l="result" aria-live="polite"></p>
      <div data-l="feedback"></div>
      <div data-l="progress"></div><div data-l="history"></div>
    </section>
    <p data-l="status" aria-live="polite">${copy.preparing}</p>`;
  root.append(host);

  const controller = new AbortController();
  let disconnectMidi = (): void => {};
  let audio: SchedulerAudioAdapter | null = null;
  let scheduler: CanonicalScheduler | null = null;
  let visualizer: TimelineVisualizer | null = null;
  let auditionEngine: SampleInstrumentEngine | null = null;
  let unregisterTransport = (): void => {};
  let removeScorePositionListener = (): void => {};
  try {
    let api: LearningApi;
    let manifest: ScoreManifest;
    let usingLocalAdapter = false;
    if (appConfig.hasLearningApi) {
      api = new LearningApiClient(appConfig.learningApiUrl, 30_000, undefined, root.dataset.privatePreview === "true");
      try { manifest = await api.manifest(songId, controller.signal); }
      catch (error) {
        if (!midiUrl || !isLearningApiUnavailable(error)) throw error;
        manifest = await manifestFromMidi(songId, midiUrl);
        api = new LocalLearningApi({ [songId]: manifest });
        usingLocalAdapter = true;
      }
    } else {
      if (!midiUrl) throw new Error("Learning resources are unavailable.");
      manifest = await manifestFromMidi(songId, midiUrl);
      api = new LocalLearningApi({ [songId]: manifest });
      usingLocalAdapter = true;
    }

    const canonicalTimeline = manifest.timeline;
    const lanes = buildVoiceLanes(manifest);
    const melodyLane = selectMelodyLane(manifest, lanes);
    let activeTiming = createActiveMelodyTimeline(canonicalTimeline, melodyLane?.notes ?? []);
    let timingMode: "original" | "active" = "original";
    let selectedLaneIds = new Set<string>(melodyLane ? [melodyLane.id] : lanes[0] ? [lanes[0].id] : []);
    const explicitHarmonies = (() => { try { return JSON.parse(root.dataset.scoreHarmonies || "[]") as ExplicitHarmony[]; } catch { return []; } })();
    const harmonies = buildHarmonicTimeline(canonicalTimeline, explicitHarmonies);
    let chordPattern: ChordPatternName = "block";
    let chordRate: PatternRate = "1/8";
    scheduler = new CanonicalScheduler(canonicalTimeline);
    audio = new SchedulerAudioAdapter(scheduler);
    audio.setHarmonicTimeline(harmonies);
    audio.setChordPattern(chordPattern, chordRate);
    const transportId = `learning-${songId}`;
    unregisterTransport = playbackCoordinator.register(transportId, {
      canPlay: () => Boolean(scheduler?.timeline.notes.length),
      isPlaying: () => scheduler?.snapshot().playing ?? false,
      play: async () => {
        try { await audio?.enable(); scheduler?.play(); }
        catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); }
      },
      pause: () => { scheduler?.pause(); audio?.reset(); },
      stop: () => { scheduler?.stop(); audio?.reset(); },
    });
    const recorder = new MidiAttemptRecorder();
    const visualRoot = host.querySelector<HTMLElement>('[data-l="visualizer"]')!;
    const maxMeasure = Math.max(1, manifest.timeline.measures.length);
    host.querySelectorAll<HTMLInputElement>('[data-l="loop-a"],[data-l="loop-b"],[data-l="exercise-a"],[data-l="exercise-b"]').forEach((input) => { input.max = String(maxMeasure); });
    host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value = String(maxMeasure);
    host.querySelector<HTMLInputElement>('[data-l="exercise-b"]')!.value = String(maxMeasure);
    const seek = host.querySelector<HTMLInputElement>('[data-l="seek"]')!;
    seek.max = String(manifest.timeline.durationSeconds);
    host.querySelector<HTMLOutputElement>('[data-l="time-value"]')!.value = `00:00 / ${formatClock(manifest.timeline.durationSeconds)}`;
    const playbackMode = host.querySelector<HTMLSelectElement>('[data-l="playback-mode"]')!;
    const staffScope = host.querySelector<HTMLSelectElement>('[data-l="staff-scope"]')!;
    const patternControl = host.querySelector<HTMLElement>('[data-l="pattern-control"]')!;
    const rateControl = host.querySelector<HTMLElement>('[data-l="rate-control"]')!;
    const patternSelect = host.querySelector<HTMLSelectElement>('[data-l="chord-pattern"]')!;
    const rateSelect = host.querySelector<HTMLSelectElement>('[data-l="chord-rate"]')!;
    const melodyToggle = host.querySelector<HTMLInputElement>('[data-l="melody"]')!;
    const melodySound = host.querySelector<HTMLSelectElement>('[data-l="melody-sound"]')!;
    if (!melodySound.options.length) melodySound.parentElement!.hidden = true;
    melodyToggle.disabled = !melodyLane;
    if (!melodyLane) host.querySelectorAll<HTMLInputElement>('[data-l="timing"] input,[data-l="rest-threshold"],[data-l="active-gap"]').forEach((input) => { input.disabled = true; });
    if (melodyLane) melodyToggle.parentElement!.append(document.createTextNode(` · ${melodyLane.label}`));
    const voiceList = host.querySelector<HTMLElement>('[data-l="voice-list"]')!;
    for (const lane of lanes) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = lane.id;
      input.checked = selectedLaneIds.has(lane.id);
      input.dataset.lane = lane.id;
      label.append(input, document.createTextNode(` ${lane.label}`));
      voiceList.append(label);
    }
    const updateLaneVisibility = (): void => {
      const scope = staffScope.value as StaffScope;
      lanes.forEach((lane) => { const input = voiceList.querySelector<HTMLInputElement>(`[data-lane="${CSS.escape(lane.id)}"]`); if (input?.parentElement) input.parentElement.hidden = !laneInScope(lane, scope); });
    };
    const updatePlaybackSelection = (): void => {
      audio?.setSelection({ mode: playbackMode.value as PlaybackMode, voices: 1, scope: staffScope.value as StaffScope }, lanes, selectedLaneIds);
      patternControl.hidden = playbackMode.value !== "chords";
      rateControl.hidden = playbackMode.value !== "chords";
      host.querySelector<HTMLElement>('[data-l="pattern-status"]')!.hidden = playbackMode.value !== "chords";
      updateLaneVisibility();
    };
    playbackMode.onchange = () => { if (playbackMode.value === "chords") melodyToggle.checked = false; updatePlaybackSelection(); };
    staffScope.onchange = updatePlaybackSelection;
    voiceList.onchange = () => {
      selectedLaneIds = new Set([...voiceList.querySelectorAll<HTMLInputElement>("[data-lane]:checked")].map((input) => input.value));
      melodyToggle.checked = Boolean(melodyLane && selectedLaneIds.size === 1 && selectedLaneIds.has(melodyLane.id));
      updatePlaybackSelection();
    };
    melodyToggle.onchange = () => {
      if (!melodyLane) return;
      if (melodyToggle.checked) {
        selectedLaneIds = new Set([melodyLane.id]);
        playbackMode.value = "solo";
      } else selectedLaneIds.delete(melodyLane.id);
      voiceList.querySelectorAll<HTMLInputElement>("[data-lane]").forEach((input) => { input.checked = selectedLaneIds.has(input.value); });
      updatePlaybackSelection();
    };
    const updateChordPattern = (): void => {
      chordPattern = patternSelect.value as ChordPatternName;
      chordRate = rateSelect.value as PatternRate;
      audio?.setChordPattern(chordPattern, chordRate);
    };
    patternSelect.onchange = updateChordPattern;
    rateSelect.onchange = updateChordPattern;
    updatePlaybackSelection();
    host.querySelector<HTMLElement>('[data-l="staff-evidence"]')!.hidden = hasExplicitStaffIdentity(manifest.timeline);
    const mapping = (() => { try { return JSON.parse(root.dataset.learningMapping || "{}"); } catch { return {}; } })() as Record<string, unknown>;
    const accordionConfig = isVerifiedAccordionConfig(mapping.accordion) ? mapping.accordion : null;
    let selectedInstrument = allowed.values().next().value ?? "piano";
    auditionEngine = new SampleInstrumentEngine();
    const audition = {
      noteOn: (midi: number): void => {
        auditionEngine?.releaseAll();
        auditionEngine?.setInstrument(selectedInstrument as InstrumentName);
        void auditionEngine?.enable([midi]).then(() => auditionEngine?.play({ midi, velocity: 0.78, durationSeconds: 1.5 })).catch((error) => { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); });
      },
      noteOff: (): void => auditionEngine?.releaseAll(),
    };
    type FollowVisualizer = TimelineVisualizer & { setFollow(enabled: boolean): void };
    type HandedVisualizer = TimelineVisualizer & { setLeftHanded(enabled: boolean): void };
    let piano: FollowVisualizer | null = null;
    let guitar: HandedVisualizer | null = null;
    let accordion: FollowVisualizer | null = null;
    let practicing = false;
    let reliable = true;
    let practiceStartedAtMs = 0;
    let exercise: Exercise | null = null;
    let waitingForMidi = false;
    let expectedMidi = new Set<number>();

    const selectInstrument = async (name: string): Promise<void> => {
      selectedInstrument = name;
      visualizer?.destroy();
      visualRoot.className = "";
      piano = null;
      guitar = null;
      accordion = null;
      let next: TimelineVisualizer;
      if (name === "piano") {
        const { PianoRangeVisualizer } = await import("./piano-visualizer");
        next = new PianoRangeVisualizer(visualRoot, manifest.timeline.notes, false, audition);
      } else if (name === "guitar") {
        const { GuitarVisualizer } = await import("./guitar-visualizer");
        next = new GuitarVisualizer(visualRoot, undefined, audition);
      } else {
        const { AccordionVisualizer } = await import("./accordion-visualizer");
        next = new AccordionVisualizer(visualRoot, name === "accordion" ? accordionConfig : null);
      }
      if (selectedInstrument !== name) return;
      audio?.setInstrument(name as "piano" | "guitar" | "accordion");
      auditionEngine?.setInstrument(name as InstrumentName);
      visualizer = next;
      if (name === "piano") piano = next as FollowVisualizer;
      if (name === "guitar") guitar = next as HandedVisualizer;
      if (name === "accordion") accordion = next as FollowVisualizer;
      visualizer.mount();
      host.querySelectorAll<HTMLButtonElement>("[data-instrument]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.instrument === name)));
      host.querySelector<HTMLElement>('[data-l="left-label"]')!.hidden = name !== "guitar";
      if (name === "accordion") host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = "Accordion audio unavailable.";
      const sound = host.querySelector<HTMLSelectElement>('[data-l="melody-sound"]');
      if (sound && (name === "piano" || name === "guitar")) sound.value = name;
      if (scheduler?.snapshot().playing) {
        try { await audio?.enable(); } catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); }
      }
    };
    await selectInstrument(selectedInstrument);
    const instrumentTabs = [...host.querySelectorAll<HTMLButtonElement>("[data-instrument]")];
    instrumentTabs.forEach((button, index) => {
      button.onclick = () => { void selectInstrument(button.dataset.instrument ?? "piano"); };
      button.onkeydown = (event) => {
        const targetIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
          ? (index + 1) % instrumentTabs.length
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? (index - 1 + instrumentTabs.length) % instrumentTabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? instrumentTabs.length - 1 : -1;
        if (targetIndex < 0) return;
        event.preventDefault();
        const target = instrumentTabs[targetIndex];
        target.focus();
        void selectInstrument(target.dataset.instrument ?? "piano");
      };
    });
    host.querySelector<HTMLInputElement>('[data-l="follow"]')!.onchange = (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      piano?.setFollow(enabled);
      accordion?.setFollow(enabled);
    };
    host.querySelector<HTMLInputElement>('[data-l="left"]')!.onchange = (event) => guitar?.setLeftHanded((event.currentTarget as HTMLInputElement).checked);

    host.querySelector<HTMLButtonElement>('[data-l="play"]')!.onclick = () => { void playbackCoordinator.play(transportId); };
    host.querySelector<HTMLButtonElement>('[data-l="pause"]')!.onclick = () => playbackCoordinator.pause(transportId);
    host.querySelector<HTMLButtonElement>('[data-l="stop"]')!.onclick = () => playbackCoordinator.stop(transportId);
    seek.oninput = () => { playbackCoordinator.activate(transportId); scheduler?.seek(Number(seek.value)); audio?.reset(); };
    host.querySelector<HTMLInputElement>('[data-l="tempo"]')!.oninput = (event) => { const input = event.currentTarget as HTMLInputElement; scheduler?.setTempo(Number(input.value)); host.querySelector<HTMLOutputElement>('[data-l="tempo-value"]')!.value = `${input.value}%`; };
    const scorePositionRequest = (event: Event): void => {
      const detail = (event as CustomEvent<ScorePositionRequest>).detail;
      if (!Number.isInteger(detail?.measureIndex) || !Number.isFinite(detail.relativePosition)) return;
      const location = resolveCanonicalScoreLocation(canonicalTimeline, detail);
      playbackCoordinator.activate(transportId);
      scheduler?.seek(timingMode === "active" ? activeTiming.originalToActive(location.seconds) : location.seconds);
      audio?.reset();
      if (location.cursorStep != null) root.dispatchEvent(new CustomEvent("learning-score-cursor", { detail: { cursorStep: location.cursorStep } }));
    };
    root.addEventListener("score-position-request", scorePositionRequest);
    removeScorePositionListener = () => root.removeEventListener("score-position-request", scorePositionRequest);
    host.querySelector<HTMLButtonElement>('[data-l="loop"]')!.onclick = () => scheduler?.setMeasureLoop(Number(host.querySelector<HTMLInputElement>('[data-l="loop-a"]')!.value) - 1, Number(host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value) - 1);
    host.querySelector<HTMLButtonElement>('[data-l="clear-loop"]')!.onclick = () => scheduler?.setLoop(null, null);
    host.querySelector<HTMLButtonElement>('[data-l="metronome"]')!.onclick = (event) => { const button = event.currentTarget as HTMLButtonElement; const enabled = button.getAttribute("aria-pressed") !== "true"; button.setAttribute("aria-pressed", String(enabled)); audio?.setMetronome(enabled); };

    try {
      const assessment = assessSynchronization(manifest.timeline, await readMidiDuration(midiUrl, fetch));
      const sync = host.querySelector<HTMLElement>('[data-l="sync"]')!;
      sync.textContent = assessment.confidence === "high" ? copy.syncHigh : assessment.confidence === "medium" ? copy.syncMedium : copy.syncUnreliable;
      sync.dataset.confidence = assessment.confidence;
    } catch (error) {
      const sync = host.querySelector<HTMLElement>('[data-l="sync"]')!;
      sync.textContent = errorMessage(error);
      sync.dataset.confidence = "unreliable";
    }

    host.querySelector<HTMLButtonElement>('[data-l="midi"]')!.onclick = async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        disconnectMidi = await connectWebMidi((message) => {
          if (!practicing) return;
          if (message.on) {
            recorder.noteOn(message.midi, message.velocity, message.atMs);
            if (waitingForMidi && expectedMidi.has(message.midi)) { waitingForMidi = false; void playbackCoordinator.play(transportId); }
          } else recorder.noteOff(message.midi, message.atMs);
        });
        button.textContent = copy.midiConnected;
      } catch (error) { button.textContent = errorMessage(error); button.disabled = false; }
    };

    const prepare = host.querySelector<HTMLButtonElement>('[data-l="prepare"]')!;
    const practice = host.querySelector<HTMLButtonElement>('[data-l="practice"]')!;
    const finish = host.querySelector<HTMLButtonElement>('[data-l="finish"]')!;
    const hasPracticeAccess = async (): Promise<boolean> => {
      if (usingLocalAdapter) return true;
      const session = await getSupabase()?.auth.getSession();
      return Boolean(session?.data.session);
    };
    const denyPractice = (): void => { host.querySelector<HTMLElement>('[data-l="practice-status"]')!.textContent = copy.signInProgress; };
    prepare.onclick = async () => {
      if (!(await hasPracticeAccess())) { denyPractice(); return; }
      prepare.disabled = true;
      const result = host.querySelector<HTMLElement>('[data-l="result"]')!;
      result.textContent = copy.generating;
      const instrument = host.querySelector<HTMLSelectElement>('[data-l="exercise-instrument"]')!.value;
      const matchingParts = manifest.parts.filter((part) => part.instrument.toLowerCase().includes(instrument)).map((part) => part.id);
      const selection: ExerciseSelection = {
        partIds: matchingParts,
        fromMeasure: Number(host.querySelector<HTMLInputElement>('[data-l="exercise-a"]')!.value),
        toMeasure: Number(host.querySelector<HTMLInputElement>('[data-l="exercise-b"]')!.value),
        tempoPercent: Number(host.querySelector<HTMLSelectElement>('[data-l="difficulty"]')!.value),
      };
      try {
        [exercise] = await api.exercises(songId, selection, controller.signal);
        if (!exercise) throw new Error("Exercise generation returned no exercise.");
        result.textContent = `${copy.exerciseReady} · ${copy.measure} ${selection.fromMeasure}–${selection.toMeasure} · ${selection.tempoPercent}%`;
        practice.disabled = false;
      } catch (error) { result.textContent = `${errorMessage(error)} ${copy.prepareRetry}`; }
      finally { prepare.disabled = false; }
    };

    practice.onclick = async () => {
      if (!exercise || !(await hasPracticeAccess())) { denyPractice(); return; }
      if (timingMode === "active") {
        host.querySelector<HTMLInputElement>('input[name="learning-timing"][value="original"]')!.checked = true;
        await switchTiming("original");
      }
      recorder.clear(); practicing = true; reliable = scheduler!.snapshot().reliable; practiceStartedAtMs = performance.now();
      exercise.mode = host.querySelector<HTMLSelectElement>('[data-l="practice-mode"]')!.value as Exercise["mode"];
      scheduler!.seek(manifest.timeline.measures[exercise.fromMeasure]?.startSeconds ?? 0);
      scheduler!.setTempo(exercise.tempoPercent);
      await audio!.enable();
      const result = host.querySelector<HTMLElement>('[data-l="result"]')!;
      const countdownBeats = Number(host.querySelector<HTMLSelectElement>('[data-l="countdown"]')!.value);
      const activeTempo = manifest.timeline.tempos.reduce(
        (bpm, tempo) => (tempo.measureIndex <= exercise!.fromMeasure ? tempo.bpm : bpm),
        120,
      );
      await countdown(countdownBeats, 60_000 / (activeTempo * exercise.tempoPercent / 100), result, controller.signal, copy.startingIn);
      await playbackCoordinator.play(transportId); practice.disabled = true; finish.disabled = false;
      result.textContent = exercise.mode === "listen" ? copy.listenStarted : exercise.mode === "wait-for-note" && !supportsWebMidi() ? copy.midiFallback : copy.practiceStarted;
    };

    finish.onclick = async () => {
      if (!exercise || !(await hasPracticeAccess())) { denyPractice(); return; }
      practicing = false; scheduler!.pause(); finish.disabled = true;
      const resultOutput = host.querySelector<HTMLElement>('[data-l="result"]')!;
      resultOutput.textContent = copy.evaluating;
      try {
        const events = recorder.result();
        const first = events[0]?.startedAtMs ?? 0;
        const result = await api.evaluate(exercise.id, events.map((event) => ({ ...event, startedAtMs: event.startedAtMs - first })), crypto.randomUUID(), controller.signal);
        if (!reliable) result.pausedForTiming = true;
        const session = await getSupabase()?.auth.getSession();
        if (usingLocalAdapter || session?.data.session) await api.saveProgress({ songId, userId: session?.data.session?.user.id ?? null, completedExercises: result.completion >= 80 ? 1 : 0, bestScore: Math.round((result.pitchScore + result.timingScore + result.durationScore) / 3), streak: result.streak, practiceSeconds: Math.max(0, (performance.now() - practiceStartedAtMs) / 1000), lastPracticedAt: new Date().toISOString() }, controller.signal);
        resultOutput.textContent = result.pausedForTiming ? copy.timingPaused : resultText(result, copy);
        const feedbackRoot = host.querySelector<HTMLElement>('[data-l="feedback"]')!;
        feedbackRoot.replaceChildren();
        const actionable = result.feedback.filter((item) => item.status !== "correct").slice(0, 50);
        if (actionable.length) {
          const title = document.createElement("h5"); title.textContent = copy.noteFeedback;
          const list = document.createElement("ol");
          actionable.forEach((item) => {
            const row = document.createElement("li");
            const expected = item.expectedMidi == null ? "—" : noteLabel(item.expectedMidi);
            const played = item.playedMidi == null ? "—" : noteLabel(item.playedMidi);
            row.textContent = `${item.status.replace("_", " ")} · ${copy.measure} ${item.measureNumber ?? "—"}, ${copy.beat} ${item.beat ?? "—"} · ${copy.expected} ${expected}, ${copy.played} ${played}${item.onsetDeltaMs == null ? "" : ` · ${item.onsetDeltaMs > 0 ? "+" : ""}${item.onsetDeltaMs} ms`}`;
            list.append(row);
          });
          feedbackRoot.append(title, list);
        }
        await refreshHistory();
      } catch (error) { resultOutput.textContent = `${errorMessage(error)} ${copy.finishRetry}`; finish.disabled = false; return; }
      practice.disabled = false;
    };

    const refreshHistory = async (): Promise<void> => {
      const session = await getSupabase()?.auth.getSession();
      if (!usingLocalAdapter && !session?.data.session) {
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = copy.signInProgress;
        host.querySelector<HTMLButtonElement>('[data-l="reset"]')!.hidden = true;
        return;
      }
      try {
        const [progress, history] = await Promise.all([api.progress(songId, controller.signal), api.history(songId, controller.signal)]);
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = `${copy.attempts} ${progress.attempts} · ${copy.best} ${progress.bestScore == null ? "—" : `${Math.round(progress.bestScore)}%`} · ${copy.recent} ${progress.recentScore == null ? "—" : `${Math.round(progress.recentScore)}%`} · ${copy.streak} ${progress.streak}`;
        host.querySelector<HTMLElement>('[data-l="history"]')!.innerHTML = history.length ? `<h5>${copy.recentAttempts}</h5><ol>${history.map((item) => `<li>${new Date(item.evaluatedAt).toLocaleString()} · pitch ${Math.round(item.pitchScore)}% · timing ${Math.round(item.timingScore)}%</li>`).join("")}</ol>` : `<p>${copy.noAttempts}</p>`;
        const perInstrument = [...allowed].map((instrument) => {
          const matching = history.filter((item) => item.instruments.includes(instrument));
          const best = matching.length ? Math.max(...matching.map((item) => (item.pitchScore + item.timingScore) / 2)) : null;
          return `${instrument}: ${matching.length} ${matching.length === 1 ? copy.attempt : copy.attemptsPlural}${best == null ? "" : ` · ${copy.best} ${Math.round(best)}%`}`;
        });
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent += ` · ${perInstrument.join(" · ")}`;
      } catch (error) { host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = `${errorMessage(error)} ${copy.progressRetry}`; }
    };

    host.querySelector<HTMLButtonElement>('[data-l="reset"]')!.onclick = async () => {
      if (!(await hasPracticeAccess())) { denyPractice(); return; }
      if (!window.confirm(copy.resetConfirm)) return;
      const result = await api.reset(songId, controller.signal);
      host.querySelector<HTMLElement>('[data-l="result"]')!.textContent = `${copy.deleted} ${result.deletedAttempts} ${copy.attemptsPlural} ${copy.and} ${result.deletedProgressEntries} ${copy.progressEntries}.`;
      await refreshHistory();
    };

    const renderFrame = (event: Event): void => {
      const frame = (event as CustomEvent<SchedulerFrame>).detail;
      reliable = reliable && frame.reliable;
      const active = audio?.selectNotes(frame.active) ?? frame.active;
      const upcoming = audio?.selectNotes(frame.upcoming) ?? frame.upcoming;
      visualizer?.render(active, upcoming);
      expectedMidi = new Set(active.map((note) => note.midi));
      if (practicing && exercise?.mode === "wait-for-note" && supportsWebMidi() && frame.playing && active.length) { waitingForMidi = true; scheduler?.pause(); }
      const cursorNote = active[0] ?? upcoming[0];
      if (cursorNote) root.dispatchEvent(new CustomEvent("learning-score-cursor", { detail: { cursorStep: cursorNote.cursorStep ?? manifest.timeline.notes.indexOf(cursorNote) } }));
      const originalPosition = timingMode === "active" ? activeTiming.activeToOriginal(frame.position) : frame.position;
      const originalMeasure = canonicalTimeline.measures.find((measure) => originalPosition >= measure.startSeconds && originalPosition < measure.startSeconds + measure.durationSeconds) ?? canonicalTimeline.measures.at(-1) ?? null;
      const originalBeat = originalMeasure ? 1 + (originalPosition - originalMeasure.startSeconds) / Math.max(0.001, originalMeasure.durationSeconds / originalMeasure.beats) : 1;
      host.querySelector<HTMLOutputElement>('[data-l="position"]')!.value = `${copy.measure} ${(originalMeasure?.index ?? 0) + 1} · ${copy.beat} ${Math.max(1, Math.floor(originalBeat))}`;
      host.querySelector<HTMLOutputElement>('[data-l="time-value"]')!.value = timingMode === "active"
        ? `ACTIVE ${formatClock(frame.position)} / ${formatClock(frame.duration)} · ${copy.originalPosition}: ${formatClock(originalPosition)}`
        : `${copy.original.toUpperCase()} ${formatClock(frame.position)} / ${formatClock(frame.duration)}`;
      seek.value = String(frame.position);
      const displayActive = timingMode === "active" ? frame.active : active;
      const displayUpcoming = timingMode === "active" ? frame.upcoming : upcoming;
      let instrumentDetail = "";
      if (selectedInstrument === "guitar" && displayActive[0]) {
        const candidate = guitarCandidates(displayActive[0])[0];
        instrumentDetail = candidate ? ` · String ${candidate.string} · Fret ${candidate.fret}` : ` · ${copy.outOfGuitarRange}`;
      }
      const prefix = melodyToggle.checked || timingMode === "active" ? `VOCAL MELODY\n` : "";
      host.querySelector<HTMLElement>('[data-l="notes"]')!.textContent = `${prefix}${copy.current}: ${displayActive.map((note) => noteLabel(note.midi)).join(" ") || "—"}${instrumentDetail} · ${copy.upcoming}: ${displayUpcoming.slice(0, 7).map((note) => noteLabel(note.midi)).join(" ") || "—"}`;
      const harmony = activeHarmonyAt(harmonies, originalPosition);
      host.querySelector<HTMLElement>('[data-l="harmony"]')!.textContent = harmony ? `${copy.currentChord}: ${harmony.label} · ${harmony.pitches.map(noteLabel).join(" ")} · ${harmony.inferred ? copy.harmonyInferred : copy.harmonySource}` : `${copy.currentChord}: —`;
      const pattern = audio?.getChordPatternStatus();
      const patternName = [...patternSelect.options].find((option) => option.value === pattern?.pattern)?.text ?? copy.block;
      host.querySelector<HTMLElement>('[data-l="pattern-status"]')!.textContent = `${copy.pattern}: ${patternName} · ${copy.rate}: ${pattern?.rate ?? chordRate} · ${copy.patternStep}: ${pattern?.step ?? "—"}`;
    };
    scheduler.addEventListener("frame", renderFrame);

    const switchTiming = async (next: "original" | "active"): Promise<void> => {
      if (!scheduler || !audio || next === timingMode) return;
      const snapshot = scheduler.snapshot();
      const canonicalPosition = timingMode === "active" ? activeTiming.activeToOriginal(snapshot.position) : snapshot.position;
      const wasPlaying = snapshot.playing;
      scheduler.removeEventListener("frame", renderFrame);
      scheduler.pause();
      audio.destroy();
      scheduler.destroy();
      timingMode = next;
      if (next === "active") {
        if (!melodyLane) return;
        melodyToggle.checked = true;
        playbackMode.value = "solo";
        selectedLaneIds = new Set([melodyLane.id]);
        voiceList.querySelectorAll<HTMLInputElement>("[data-lane]").forEach((input) => { input.checked = selectedLaneIds.has(input.value); });
      }
      const timeline = next === "active" ? activeTiming.timeline : canonicalTimeline;
      playbackCoordinator.activate(transportId);
      scheduler = new CanonicalScheduler(timeline);
      audio = new SchedulerAudioAdapter(scheduler);
      audio.setInstrument(selectedInstrument as InstrumentName);
      audio.setHarmonicTimeline(harmonies);
      audio.setChordPattern(chordPattern, chordRate);
      updatePlaybackSelection();
      scheduler.addEventListener("frame", renderFrame);
      scheduler.seek(next === "active" ? activeTiming.originalToActive(canonicalPosition) : canonicalPosition);
      seek.max = String(timeline.durationSeconds);
      if (wasPlaying) { try { await audio.enable(); scheduler.play(); } catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); } }
    };
    host.querySelectorAll<HTMLInputElement>('input[name="learning-timing"]').forEach((input) => { input.onchange = () => { if (input.checked) void switchTiming(input.value as "original" | "active"); }; });
    const rebuildActiveTiming = (): void => {
      const options = { restThresholdSeconds: Number(host.querySelector<HTMLInputElement>('[data-l="rest-threshold"]')!.value), compressedGapSeconds: Number(host.querySelector<HTMLInputElement>('[data-l="active-gap"]')!.value) };
      if (timingMode === "active") void switchTiming("original").then(() => { activeTiming = createActiveMelodyTimeline(canonicalTimeline, melodyLane?.notes ?? [], options); return switchTiming("active"); });
      else activeTiming = createActiveMelodyTimeline(canonicalTimeline, melodyLane?.notes ?? [], options);
    };
    host.querySelector<HTMLInputElement>('[data-l="rest-threshold"]')!.onchange = rebuildActiveTiming;
    host.querySelector<HTMLInputElement>('[data-l="active-gap"]')!.onchange = rebuildActiveTiming;
    melodySound.onchange = (event) => { const name = (event.currentTarget as HTMLSelectElement).value; void selectInstrument(name); };
    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = usingLocalAdapter ? (appConfig.hasLearningApi ? copy.apiFallback : copy.localAdapter) : copy.apiConnected;
    if (!(await hasPracticeAccess())) {
      prepare.disabled = true;
      practice.disabled = true;
      finish.disabled = true;
      host.querySelector<HTMLButtonElement>('[data-l="reset"]')!.hidden = true;
      denyPractice();
    }
    await refreshHistory();
  } catch (error) {
    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error);
  }

  return () => {
    controller.abort(); disconnectMidi(); unregisterTransport(); removeScorePositionListener(); audio?.destroy(); scheduler?.destroy(); visualizer?.destroy(); auditionEngine?.destroy(); scoreCleanup(); host.remove();
  };
}
