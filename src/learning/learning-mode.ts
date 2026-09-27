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
import { mountMidiLab } from "./midi-lab";
import { hasExplicitStaffIdentity, noteMatchesStaffScope, type PlaybackMode, type StaffScope } from "./playback-selection";
import { buildActiveTrackOptions, buildVoiceLanes, laneInScope, resolveActiveTrack, selectMelodyLane, type ActiveTrackId, type VoiceLane } from "./voice-lanes";
import { composeLearningMelody, replaceLearningSegmentSource, retainLearningSegmentRest, type LearningMelody } from "./learning-melody";
import { activeHarmonyAt, buildHarmonicTimeline, type ExplicitHarmony, type HarmonicEvent } from "./harmony";
import { SampleInstrumentEngine, type InstrumentName } from "../audio/sample-instrument";
import { guitarCandidates } from "./instruments";
import type { ChordPatternName, PatternRate } from "./chord-patterns";
import type { InspectedMidiTrack } from "./midi-inspector";
import { MelodyScoreView } from "./melody-score";
import { buildStudyArrangement, describeStudyKey, parseSourceKey, transformLearningTimeline, type LearningPart, type LearningTiming, type StudyMode, type StudyVoiceCount, type WorkstationTransform } from "./workstation-model";

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
  const language = getInitialLanguage();
  const copy = getLearningCopy(language);
  const scoreCleanup = await mountScoreViewer(root, { midiPlayback: false });
  const midiUrl = root.dataset.midiUrl;
  const songId = root.dataset.songId ?? "";
  if (root.dataset.learningEnabled !== "true" || !songId || (!appConfig.hasLearningApi && !midiUrl)) return scoreCleanup;

  const allowed = new Set((root.dataset.learningInstruments || "piano").split(",").filter(Boolean));
  const selectionHelpers = await import("./learning-selection");
  const host = document.createElement("section");
  host.className = "learning-mode";
  host.setAttribute("aria-labelledby", "learning-mode-title");
  host.innerHTML = `
    <header class="learning-workstation-heading"><div><p class="eyebrow">MUSIC LEARNING WORKSTATION</p><h3 id="learning-mode-title">${copy.title}</h3></div><details class="learning-help"><summary aria-label="Learning workstation help">?</summary><p>${copy.clock}</p><p data-l="sync" class="learning-sync" aria-live="polite">${copy.checking}</p></details></header>
    <p class="learning-source-status"><span>Melody source:</span> <strong data-l="melody-source">—</strong></p>
    <div class="learning-workstation-controls">
      <div class="learning-workstation-row learning-workstation-row-primary">
        <fieldset class="learning-control-group learning-transport-compact"><legend>TRANSPORT</legend><button type="button" data-l="play">▶ ${copy.play}</button><button type="button" data-l="pause">Ⅱ ${copy.pause}</button><button type="button" data-l="stop">■ ${copy.stop}</button><label><span>${copy.tempo}</span><input data-l="tempo" type="range" min="50" max="150" value="100"><output data-l="tempo-value">100%</output></label><label class="learning-position"><span>${copy.position}</span><input data-l="seek" type="range" min="0" max="0" value="0" step="0.01"><output data-l="time-value">00:00 / 00:00</output></label><output data-l="position">${copy.measure} 1 · ${copy.beat} 1</output></fieldset>
        ${selectionHelpers.learningSelectionControlsHtml}
        <fieldset class="learning-control-group learning-segments" data-l="play-group"><legend>PLAY</legend><button type="button" data-play="solo" aria-pressed="true">SOLO</button><button type="button" data-play="chords" aria-pressed="false">CHORDS</button></fieldset>
        <fieldset class="learning-control-group learning-segments" data-l="voices-group"><legend>VOICES</legend>${[1,2,3,4].map((voice) => `<button type="button" data-voices="${voice}" aria-pressed="${voice === 1}">${voice}</button>`).join("")}</fieldset>
      </div>
      <div class="learning-workstation-row learning-workstation-row-secondary">
        <fieldset class="learning-control-group learning-segments" data-l="timing"><legend>MELODY TIMING</legend><button type="button" data-timing="continuous" aria-pressed="true">CONTINUOUS</button><button type="button" data-timing="original" aria-pressed="false">ORIGINAL</button></fieldset>
        <fieldset class="learning-control-group learning-segments" data-l="sound-control"><legend>MELODY SOUND</legend>${allowed.has("piano") ? `<button type="button" data-sound="piano" aria-pressed="true">PIANO</button>` : ""}${allowed.has("guitar") ? `<button type="button" data-sound="guitar" aria-pressed="false">GUITAR</button>` : ""}<button type="button" data-sound="accordion" aria-pressed="false">ACCORDION</button><select data-l="melody-sound" hidden>${allowed.has("piano") ? `<option value="piano">${copy.piano}</option>` : ""}${allowed.has("guitar") ? `<option value="guitar">${copy.guitar}</option>` : ""}<option value="accordion">${copy.accordion}</option></select></fieldset>
        <fieldset class="learning-control-group learning-chord-controls" data-l="chord-controls" hidden><legend>CHORDS</legend><label>${copy.pattern}<select data-l="chord-pattern"><option value="block">${copy.block}</option><option value="bass-12321">Bass · 1 2 3 2 1</option><option value="bass-123-bass-123">Bass · 1 2 3 · Bass · 1 2 3</option><option value="bass-1323">Bass · 1 3 2 3</option><option value="bass-321">Bass · 3 2 1</option><option value="up">Up</option><option value="down">Down</option><option value="up-down">Up / Down</option><option value="alberti">Alberti</option></select></label><label>${copy.rate}<select data-l="chord-rate"><option value="1/4">1/4</option><option value="1/8" selected>1/8</option><option value="1/16">1/16</option></select></label><div class="learning-segments"><span>Accompaniment</span><button type="button" data-accompaniment="off" aria-pressed="false">OFF</button><button type="button" data-accompaniment="on" aria-pressed="true">ON</button></div></fieldset>
        <fieldset class="learning-control-group learning-pitch"><legend>PITCH</legend><div><span>Octave</span><button type="button" data-transpose="-12">−12</button><button type="button" data-transpose="12">+12</button></div><div><span>Semitone</span><button type="button" data-transpose="-1">−1</button><button type="button" data-transpose="1">+1</button></div><output data-l="transpose-value">0 st</output><button type="button" data-transpose-reset>Reset</button></fieldset>
        <fieldset class="learning-control-group"><legend>KEY</legend><select data-l="target-key"><option value="">Original</option>${["C","C#/Db","D","D#/Eb","E","F","F#/Gb","G","G#/Ab","A","A#/Bb","B"].map((name,index)=>`<option value="${index}">${name}</option>`).join("")}</select><output data-l="key-status"></output></fieldset>
        <fieldset class="learning-control-group learning-segments" data-l="mode-group"><legend>MODE</legend><button type="button" data-mode="original" aria-pressed="true">ORIGINAL</button><button type="button" data-mode="major" aria-pressed="false">MAJOR</button><button type="button" data-mode="minor" aria-pressed="false">MINOR</button></fieldset>
      </div>
    </div>
    <input data-l="melody" type="checkbox" checked hidden><input data-l="chords-layer" type="checkbox" hidden><select data-l="playback-mode" hidden><option value="solo">${copy.solo}</option><option value="chords">${copy.chords}</option></select><select data-l="staff-scope" hidden><option value="treble">${copy.treble}</option><option value="bass">${copy.bass}</option><option value="both">${copy.both}</option></select>
    <section class="learning-status-strip"><button type="button" data-l="harmony" class="learning-chord-audition" disabled aria-label="Audition active chord">ACTIVE CHORD: —</button><p data-l="pattern-status" aria-live="polite" hidden></p><p data-l="notes">${copy.current}: — · ${copy.upcoming}: —</p></section>
    <section class="learning-melody-score" aria-labelledby="melody-score-title"><div class="learning-melody-score-heading"><h4 id="melody-score-title">LEARNING MELODY</h4><div><button type="button" data-l="score-melody" aria-pressed="true">Melody score</button><button type="button" data-l="score-full" aria-pressed="false">Full score</button><button type="button" data-l="marker" aria-pressed="true">Marker</button></div></div><div data-l="melody-score"></div></section>
    ${selectionHelpers.learningVisualizerHtml}
    <details class="learning-workstation-advanced"><summary>Advanced controls</summary><div class="learning-advanced-grid"><button type="button" data-l="metronome" aria-pressed="false">${copy.metronome}</button><label><input type="checkbox" data-l="follow"> ${copy.follow}</label><label data-l="left-label" hidden><input type="checkbox" data-l="left"> ${copy.leftHanded}</label><label>${copy.loopFrom}<input data-l="loop-a" type="number" min="1" value="1"></label><label>${copy.to}<input data-l="loop-b" type="number" min="1" value="1"></label><button type="button" data-l="loop">${copy.setLoop}</button><button type="button" data-l="clear-loop">${copy.clearLoop}</button></div><div class="learning-mix-levels"><label>Melody <input data-l="melody-level" type="range" min="0" max="100" value="90"></label><label>Chords <input data-l="chords-level" type="range" min="0" max="100" value="62"></label><label>Metronome <input data-l="metronome-level" type="range" min="0" max="100" value="55"></label></div><details class="learning-voice-picker"><summary>Source voices</summary><div data-l="voice-list"></div><p data-l="staff-evidence" hidden>${copy.inferredStaff}</p></details><details class="learning-segment-map"><summary>Learning Melody segment map</summary><div data-l="segment-map"></div><p data-l="continuity"></p></details></details>
    <details class="learning-midi-advanced"><summary>Advanced / MIDI Lab</summary><div data-l="midi-lab"></div></details>
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
  let clearInstrumentVisuals = (): void => undefined;
  let unregisterTransport = (): void => {};
  let removeScorePositionListener = (): void => {};
  let midiLabCleanup = (): void => {};
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

    const { applyStaffControlState, applyVisualizerAvailability, rememberLearningSelection, renderActiveTrackOptions, resolveStaffScope, restoreLearningSelection, staffScopeSupport, visualizerAvailability } = selectionHelpers;
    const canonicalTimeline = manifest.timeline;
    const lanes = buildVoiceLanes(manifest);
    const melodyLane = selectMelodyLane(manifest, lanes);
    const activeTrackOptions = buildActiveTrackOptions(manifest, lanes, melodyLane);
    const rememberedSelection = (() => { try { return restoreLearningSelection(window.localStorage, songId); } catch { return null; } })();
    const initialTrackResolution = resolveActiveTrack((rememberedSelection?.activeTrackId ?? "melody") as ActiveTrackId, activeTrackOptions);
    const initialActiveTrack = initialTrackResolution.option;
    let selectedStaffScope = resolveStaffScope(rememberedSelection?.staffScope, staffScopeSupport(initialActiveTrack));
    let learningMelody = composeLearningMelody(canonicalTimeline, lanes, { primaryLane: initialActiveTrack?.lane ?? null });
    let selectedLaneIds = new Set<string>(initialActiveTrack ? [initialActiveTrack.lane.id] : []);
    const explicitHarmonies = (() => { try { return JSON.parse(root.dataset.scoreHarmonies || "[]") as ExplicitHarmony[]; } catch { return []; } })();
    const canonicalHarmonies = buildHarmonicTimeline(canonicalTimeline, explicitHarmonies);
    let transformState: WorkstationTransform = { timing: "continuous", mode: "original", targetTonic: null, transpose: 0, sourceKey: parseSourceKey(root.dataset.musicalKey) };
    let timingMode: LearningTiming = "continuous";
    let selectedTrackId: ActiveTrackId = initialActiveTrack?.id ?? "melody";
    let selectedPart: LearningPart = initialActiveTrack?.arrangementPart ?? "melody";
    let studyVoices: StudyVoiceCount = 1;
    let accompaniment = false;
    let transformed = transformLearningTimeline(learningMelody.timeline, transformState);
    let primaryIds = new Set(transformed.timeline.notes.map((note) => note.id));
    let harmonies = buildHarmonicTimeline(transformed.timeline);
    let arrangement = buildStudyArrangement(transformed.timeline, harmonies, selectedPart, studyVoices);
    let chordPattern: ChordPatternName = "block";
    let chordRate: PatternRate = "1/8";
    scheduler = new CanonicalScheduler(arrangement);
    audio = new SchedulerAudioAdapter(scheduler);
    audio.setHarmonicTimeline(harmonies);
    audio.setChordPattern(chordPattern, chordRate);
    audio.setLearningLayers({ melody: true, chords: false }, arrangement.notes);
    let selectedInstrument = "piano";
    const transportId = `learning-${songId}`;
    unregisterTransport = playbackCoordinator.register(transportId, {
      canPlay: () => Boolean(scheduler?.timeline.notes.length),
      isPlaying: () => scheduler?.snapshot().playing ?? false,
      play: async () => {
        try { await audio?.enable(); scheduler?.play(); }
        catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); }
      },
      pause: () => { scheduler?.pause(); audio?.reset(); },
      stop: () => { scheduler?.stop(); audio?.reset(); clearInstrumentVisuals(); },
    });
    playbackCoordinator.activate(transportId);
    const recorder = new MidiAttemptRecorder();
    const visualRoot = host.querySelector<HTMLElement>('[data-l="visualizer"]')!;
    const melodyScore = new MelodyScoreView(host.querySelector<HTMLElement>('[data-l="melody-score"]')!, transformed.timeline.notes);
    melodyScore.mount();
    let applySessionMelody: (track: InspectedMidiTrack) => void = () => undefined;
    let applyGapFill: (track: InspectedMidiTrack) => void = () => undefined;
    let rebuildWorkstation: () => Promise<void> = async () => undefined;
    midiLabCleanup = await mountMidiLab(host.querySelector<HTMLElement>('[data-l="midi-lab"]')!, {
      canonicalUrl: midiUrl,
      canonicalTimeline: manifest.timeline,
      onSessionMelody: (track) => { host.dataset.sessionMelody = `${track.sourceName}:${track.trackIndex}`; applySessionMelody(track); },
      onGapFill: (track) => { host.dataset.gapFillSource = `${track.sourceName}:${track.trackIndex}`; applyGapFill(track); },
    });
    const maxMeasure = Math.max(1, manifest.timeline.measures.length);
    host.querySelectorAll<HTMLInputElement>('[data-l="loop-a"],[data-l="loop-b"],[data-l="exercise-a"],[data-l="exercise-b"]').forEach((input) => { input.max = String(maxMeasure); });
    host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value = String(maxMeasure);
    host.querySelector<HTMLInputElement>('[data-l="exercise-b"]')!.value = String(maxMeasure);
    const seek = host.querySelector<HTMLInputElement>('[data-l="seek"]')!;
    seek.max = String(arrangement.durationSeconds);
    host.querySelector<HTMLOutputElement>('[data-l="time-value"]')!.value = `CONTINUOUS 00:00 / ${formatClock(arrangement.durationSeconds)}`;
    const playbackMode = host.querySelector<HTMLSelectElement>('[data-l="playback-mode"]')!;
    const staffScope = host.querySelector<HTMLSelectElement>('[data-l="staff-scope"]')!;
    const activeTrackSelect = host.querySelector<HTMLSelectElement>('[data-l="active-track"]')!;
    renderActiveTrackOptions(activeTrackSelect, activeTrackOptions, selectedTrackId);
    staffScope.value = selectedStaffScope;
    const chordControls = host.querySelector<HTMLElement>('[data-l="chord-controls"]')!;
    const patternSelect = host.querySelector<HTMLSelectElement>('[data-l="chord-pattern"]')!;
    const rateSelect = host.querySelector<HTMLSelectElement>('[data-l="chord-rate"]')!;
    const melodyToggle = host.querySelector<HTMLInputElement>('[data-l="melody"]')!;
    const chordsToggle = host.querySelector<HTMLInputElement>('[data-l="chords-layer"]')!;
    const melodySound = host.querySelector<HTMLSelectElement>('[data-l="melody-sound"]')!;
    if (!melodySound.options.length) host.querySelector<HTMLElement>('[data-l="sound-control"]')!.hidden = true;
    melodyToggle.disabled = !learningMelody.notes.length;
    host.querySelector<HTMLElement>('[data-l="melody-source"]')!.textContent = melodyLane ? `canonical · ${melodyLane.label} · ${melodyLane.inferred ? "INFERRED" : "VERIFIED"}` : "No melody source";
    const voiceList = host.querySelector<HTMLElement>('[data-l="voice-list"]')!;
    let updateVisualizerAvailability = (): void => undefined;
    const persistSelection = (): void => {
      try { rememberLearningSelection(window.localStorage, songId, { activeTrackId: selectedTrackId, staffScope: selectedStaffScope }); } catch { /* Keep session selection active. */ }
    };
    const currentTrackOption = () => activeTrackOptions.find((option) => option.id === selectedTrackId) ?? null;
    const updateStaffControls = (): void => {
      const support = staffScopeSupport(currentTrackOption());
      selectedStaffScope = resolveStaffScope(selectedStaffScope, support);
      staffScope.value = selectedStaffScope;
      applyStaffControlState(host, selectedStaffScope, support);
    };
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
      const scope = selectedStaffScope;
      lanes.forEach((lane) => { const input = voiceList.querySelector<HTMLInputElement>(`[data-lane="${CSS.escape(lane.id)}"]`); if (input?.parentElement) input.parentElement.hidden = !laneInScope(lane, scope); });
    };
    const updatePlaybackSelection = (): void => {
      audio?.setSelection({ mode: playbackMode.value as PlaybackMode, voices: 1, scope: selectedStaffScope }, lanes, selectedLaneIds);
      audio?.setLearningLayers({ melody: true, chords: accompaniment }, scheduler?.timeline.notes ?? arrangement.notes);
      chordControls.hidden = playbackMode.value !== "chords";
      host.querySelector<HTMLElement>('[data-l="pattern-status"]')!.hidden = !chordsToggle.checked;
      updateLaneVisibility();
      updateVisualizerAvailability();
      const frame = scheduler?.snapshot();
      if (frame) visualizer?.render(frame.active.filter((note) => noteMatchesStaffScope(note, selectedStaffScope)), frame.upcoming.filter((note) => noteMatchesStaffScope(note, selectedStaffScope)));
    };
    playbackMode.onchange = updatePlaybackSelection;
    staffScope.onchange = () => { selectedStaffScope = staffScope.value as StaffScope; updateStaffControls(); persistSelection(); updatePlaybackSelection(); };
    voiceList.onchange = () => {
      selectedLaneIds = new Set([...voiceList.querySelectorAll<HTMLInputElement>("[data-lane]:checked")].map((input) => input.value));
      updatePlaybackSelection();
    };
    melodyToggle.onchange = updatePlaybackSelection;
    chordsToggle.onchange = updatePlaybackSelection;
    const updateMix = (): void => audio?.setLevels({
      melody: Number(host.querySelector<HTMLInputElement>('[data-l="melody-level"]')!.value) / 100,
      chords: Number(host.querySelector<HTMLInputElement>('[data-l="chords-level"]')!.value) / 100,
      metronome: Number(host.querySelector<HTMLInputElement>('[data-l="metronome-level"]')!.value) / 100,
    });
    host.querySelectorAll<HTMLInputElement>('[data-l="melody-level"],[data-l="chords-level"],[data-l="metronome-level"]').forEach((input) => { input.oninput = updateMix; });
    const updateChordPattern = (): void => {
      chordPattern = patternSelect.value as ChordPatternName;
      chordRate = rateSelect.value as PatternRate;
      audio?.setChordPattern(chordPattern, chordRate);
    };
    patternSelect.onchange = updateChordPattern;
    rateSelect.onchange = updateChordPattern;
    updatePlaybackSelection();
    updateMix();
    updateStaffControls();
    if (initialTrackResolution.usedFallback || rememberedSelection) persistSelection();
    host.querySelector<HTMLElement>('[data-l="staff-evidence"]')!.hidden = hasExplicitStaffIdentity(manifest.timeline);
    const mapping = (() => { try { return JSON.parse(root.dataset.learningMapping || "{}"); } catch { return {}; } })() as Record<string, unknown>;
    const accordionConfig = isVerifiedAccordionConfig(mapping.accordion) ? mapping.accordion : null;
    selectedInstrument = melodySound.value || "piano";
    auditionEngine = new SampleInstrumentEngine();
    const audition = {
      noteOn: (midi: number, instrument?: "piano" | "guitar"): void => {
        auditionEngine?.releaseAll();
        auditionEngine?.setInstrument((instrument ?? selectedInstrument) as InstrumentName);
        void auditionEngine?.enable([midi]).then(() => auditionEngine?.play({ midi, velocity: 0.78, durationSeconds: 1.5 })).catch((error) => { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); });
      },
      noteOff: (): void => auditionEngine?.releaseAll(),
    };
    type FollowVisualizer = TimelineVisualizer & { setFollow(enabled: boolean): void };
    type HandedVisualizer = TimelineVisualizer & { setLeftHanded(enabled: boolean): void; setActiveChord(harmony: HarmonicEvent | null): void; clear(): void };
    let piano: FollowVisualizer | null = null;
    let guitar: HandedVisualizer | null = null;
    let accordion: FollowVisualizer | null = null;
    const visualizerUnavailable = host.querySelector<HTMLElement>('[data-l="visualizer-unavailable"]')!;
    updateVisualizerAvailability = (): void => {
      const state = visualizerAvailability(selectedInstrument as InstrumentName, currentTrackOption(), selectedStaffScope, accordionConfig);
      applyVisualizerAvailability(visualRoot, visualizerUnavailable, state);
    };
    let practicing = false;
    let reliable = true;
    let practiceStartedAtMs = 0;
    let exercise: Exercise | null = null;
    let waitingForMidi = false;
    let expectedMidi = new Set<number>();
    let activeHarmony: HarmonicEvent | null = null;
    const harmonyButton = host.querySelector<HTMLButtonElement>('[data-l="harmony"]')!;
    const showHarmony = (harmony: HarmonicEvent | null): void => {
      activeHarmony = playbackMode.value === "chords" ? harmony : null;
      harmonyButton.textContent = activeHarmony ? `ACTIVE CHORD: ${activeHarmony.label}` : "ACTIVE CHORD: —";
      harmonyButton.disabled = !activeHarmony;
      guitar?.setActiveChord(activeHarmony);
    };
    const updateHarmonyAtCurrentPosition = (): void => showHarmony(activeHarmonyAt(harmonies, scheduler?.snapshot().position ?? 0));
    clearInstrumentVisuals = (): void => {
      auditionEngine?.releaseAll();
      visualizer?.render([], []);
      guitar?.clear();
      visualRoot.querySelectorAll(".manual-audition").forEach((element) => element.classList.remove("manual-audition"));
      showHarmony(null);
    };
    harmonyButton.onclick = (): void => {
      const harmony = activeHarmony;
      if (!harmony) return;
      const notes = selectedInstrument === "guitar" && harmony.guitar.length ? harmony.guitar.map((position) => position.midi) : harmony.pitches;
      auditionEngine?.releaseAll();
      auditionEngine?.setInstrument(selectedInstrument as InstrumentName);
      void auditionEngine?.enable(notes).then(() => notes.forEach((midi) => auditionEngine?.play({ midi, velocity: 0.68, durationSeconds: 1.2 }))).catch((error) => { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); });
    };

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
        next = new PianoRangeVisualizer(visualRoot, scheduler?.timeline.notes ?? arrangement.notes, false, audition);
      } else if (name === "guitar") {
        const { GuitarVisualizer } = await import("./guitar-visualizer");
        next = new GuitarVisualizer(visualRoot, undefined, audition);
      } else {
        const { AccordionVisualizer } = await import("./accordion-visualizer");
        next = new AccordionVisualizer(visualRoot, name === "accordion" ? accordionConfig : null, audition);
      }
      if (selectedInstrument !== name) return;
      audio?.setInstrument(name as "piano" | "guitar" | "accordion");
      auditionEngine?.setInstrument(name as InstrumentName);
      visualizer = next;
      if (name === "piano") piano = next as FollowVisualizer;
      if (name === "guitar") guitar = next as HandedVisualizer;
      if (name === "accordion") accordion = next as FollowVisualizer;
      visualizer.mount();
      updateVisualizerAvailability();
      updateHarmonyAtCurrentPosition();
      if (name === "piano" || name === "guitar") melodyScore.setInstrument(name);
      host.querySelector<HTMLElement>('[data-l="left-label"]')!.hidden = name !== "guitar";
      melodySound.value = name;
      host.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sound === name)));
      if (scheduler?.snapshot().playing) {
        try { await audio?.enable(); } catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); }
      }
    };
    await selectInstrument(selectedInstrument);
    host.querySelector<HTMLInputElement>('[data-l="follow"]')!.onchange = (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      piano?.setFollow(enabled);
      accordion?.setFollow(enabled);
    };
    host.querySelector<HTMLInputElement>('[data-l="left"]')!.onchange = (event) => guitar?.setLeftHanded((event.currentTarget as HTMLInputElement).checked);

    const fullScore = root.querySelector<HTMLElement>(".score-canvas");
    const melodyScoreContent = host.querySelector<HTMLElement>('[data-l="melody-score"]')!;
    const setScoreView = (view: "melody" | "full"): void => {
      if (fullScore) fullScore.hidden = view !== "full";
      melodyScoreContent.hidden = view !== "melody";
      host.querySelector<HTMLButtonElement>('[data-l="score-melody"]')!.setAttribute("aria-pressed", String(view === "melody"));
      host.querySelector<HTMLButtonElement>('[data-l="score-full"]')!.setAttribute("aria-pressed", String(view === "full"));
    };
    // The canonical notation (including the selected instrument part) is the
    // primary Learning score. The derived melody strip remains opt-in.
    setScoreView("full");
    host.querySelector<HTMLButtonElement>('[data-l="score-melody"]')!.onclick = () => setScoreView("melody");
    host.querySelector<HTMLButtonElement>('[data-l="score-full"]')!.onclick = () => setScoreView("full");
    host.querySelector<HTMLButtonElement>('[data-l="marker"]')!.onclick = (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const enabled = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(enabled));
      root.classList.toggle("learning-marker-hidden", !enabled);
    };

    host.querySelector<HTMLButtonElement>('[data-l="play"]')!.onclick = () => { void playbackCoordinator.play(transportId); };
    host.querySelector<HTMLButtonElement>('[data-l="pause"]')!.onclick = () => playbackCoordinator.pause(transportId);
    host.querySelector<HTMLButtonElement>('[data-l="stop"]')!.onclick = () => playbackCoordinator.stop(transportId);
    seek.oninput = () => { playbackCoordinator.activate(transportId); guitar?.clear(); scheduler?.seek(Number(seek.value)); audio?.reset(); };
    host.querySelector<HTMLInputElement>('[data-l="tempo"]')!.oninput = (event) => { const input = event.currentTarget as HTMLInputElement; scheduler?.setTempo(Number(input.value)); host.querySelector<HTMLOutputElement>('[data-l="tempo-value"]')!.value = `${input.value}%`; };
    const dispatchLearningMarker = (note: NoteEvent | null): void => {
      if (!note || host.querySelector<HTMLButtonElement>('[data-l="marker"]')!.getAttribute("aria-pressed") !== "true") return;
      const sourceId = "sourceNoteId" in note ? String(note.sourceNoteId) : note.id;
      const original = learningMelody.notes.find((entry) => entry.sourceNoteId === sourceId || entry.id === note.id) ?? note;
      const measure = canonicalTimeline.measures[original.measureIndex];
      const relativePosition = measure ? Math.max(0, Math.min(1, (original.startSeconds - measure.startSeconds) / Math.max(0.001, measure.durationSeconds))) : 0;
      root.dispatchEvent(new CustomEvent("learning-marker-request", { detail: { noteId: sourceId, measureIndex: original.measureIndex, staffIndex: original.staff == null ? undefined : original.staff - 1, relativePosition, midi: original.midi } }));
    };
    const scorePositionRequest = (event: Event): void => {
      const detail = (event as CustomEvent<ScorePositionRequest>).detail;
      if (!Number.isInteger(detail?.measureIndex) || !Number.isFinite(detail.relativePosition)) return;
      const location = resolveCanonicalScoreLocation(canonicalTimeline, detail);
      const candidates = learningMelody.notes.filter((note) => note.measureIndex === detail.measureIndex);
      const learningNote = learningMelody.notes.find((note) => note.sourceNoteId === location.noteId) ?? candidates.reduce<LearningMelody["notes"][number] | null>((closest, note) => {
        if (!closest) return note;
        const noteDistance = Math.abs(note.startSeconds - location.seconds) + (detail.midi == null ? 0 : Math.abs(note.midi - detail.midi) * 0.002);
        const closestDistance = Math.abs(closest.startSeconds - location.seconds) + (detail.midi == null ? 0 : Math.abs(closest.midi - detail.midi) * 0.002);
        return noteDistance < closestDistance ? note : closest;
      }, null);
      const originalSeconds = learningNote?.startSeconds ?? location.seconds;
      root.dispatchEvent(new CustomEvent("score-pointer-resolved", { detail: { ...detail, seconds: originalSeconds, noteId: learningNote?.sourceNoteId ?? location.noteId } }));
      playbackCoordinator.activate(transportId);
      scheduler?.seek(transformed.originalToStudy(originalSeconds));
      audio?.reset();
      dispatchLearningMarker(learningNote);
    };
    root.addEventListener("score-position-request", scorePositionRequest);
    const melodySeekRequest = (event: Event): void => {
      const noteId = String((event as CustomEvent<{ noteId?: string }>).detail?.noteId ?? "");
      const note = learningMelody.notes.find((entry) => entry.id === noteId);
      if (!note) return;
      playbackCoordinator.activate(transportId);
      scheduler?.seek(transformed.originalToStudy(note.startSeconds));
      audio?.reset(); dispatchLearningMarker(note);
    };
    root.addEventListener("learning-melody-seek", melodySeekRequest);
    removeScorePositionListener = () => { root.removeEventListener("score-position-request", scorePositionRequest); root.removeEventListener("learning-melody-seek", melodySeekRequest); };
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
      if (timingMode !== "original") {
        transformState = { ...transformState, timing: "original" };
        timingMode = "original";
        host.querySelectorAll<HTMLButtonElement>("[data-timing]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.timing === "original")));
        await rebuildWorkstation();
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
      const active = frame.active.filter((note) => noteMatchesStaffScope(note, selectedStaffScope));
      const upcoming = frame.upcoming.filter((note) => noteMatchesStaffScope(note, selectedStaffScope));
      visualizer?.render(active, upcoming);
      expectedMidi = new Set(active.map((note) => note.midi));
      if (practicing && exercise?.mode === "wait-for-note" && supportsWebMidi() && frame.playing && active.length) { waitingForMidi = true; scheduler?.pause(); }
      const activePrimary = active.filter((note) => primaryIds.has(note.id));
      const upcomingPrimary = upcoming.filter((note) => primaryIds.has(note.id));
      const cursorNote = activePrimary[0] ?? upcomingPrimary[0];
      if (cursorNote) dispatchLearningMarker(cursorNote);
      melodyScore.setActive(cursorNote?.id ?? null);
      const originalPosition = transformed.studyToOriginal(frame.position);
      const originalMeasure = canonicalTimeline.measures.find((measure) => originalPosition >= measure.startSeconds && originalPosition < measure.startSeconds + measure.durationSeconds) ?? canonicalTimeline.measures.at(-1) ?? null;
      const originalBeat = originalMeasure ? 1 + (originalPosition - originalMeasure.startSeconds) / Math.max(0.001, originalMeasure.durationSeconds / originalMeasure.beats) : 1;
      host.querySelector<HTMLOutputElement>('[data-l="position"]')!.value = `${copy.measure} ${(originalMeasure?.index ?? 0) + 1} · ${copy.beat} ${Math.max(1, Math.floor(originalBeat))}`;
      host.querySelector<HTMLOutputElement>('[data-l="time-value"]')!.value = timingMode === "continuous"
        ? `CONTINUOUS ${formatClock(frame.position)} / ${formatClock(frame.duration)} · ${copy.originalPosition}: ${formatClock(originalPosition)}`
        : `${copy.original.toUpperCase()} ${formatClock(frame.position)} / ${formatClock(frame.duration)}`;
      seek.value = String(frame.position);
      const displayActive = activePrimary;
      const displayUpcoming = upcomingPrimary;
      let instrumentDetail = "";
      if (selectedInstrument === "guitar" && displayActive[0]) {
        const candidate = guitarCandidates(displayActive[0])[0];
        instrumentDetail = candidate ? ` · String ${candidate.string} · Fret ${candidate.fret}` : ` · ${copy.outOfGuitarRange}`;
      }
      const prefix = `LEARNING MELODY\n`;
      host.querySelector<HTMLElement>('[data-l="notes"]')!.textContent = `${prefix}${copy.current}: ${displayActive.map((note) => noteLabel(note.midi)).join(" ") || "—"}${instrumentDetail} · ${copy.upcoming}: ${displayUpcoming.slice(0, 7).map((note) => noteLabel(note.midi)).join(" ") || "—"}`;
      const harmony = activeHarmonyAt(harmonies, frame.position);
      showHarmony(harmony);
      harmonyButton.title = harmony ? `${harmony.pitches.map(noteLabel).join(" ")} · ${harmony.inferred ? copy.harmonyInferred : copy.harmonySource}` : "";
      const pattern = audio?.getChordPatternStatus();
      const patternName = [...patternSelect.options].find((option) => option.value === pattern?.pattern)?.text ?? copy.block;
      host.querySelector<HTMLElement>('[data-l="pattern-status"]')!.textContent = `${copy.pattern}: ${patternName} · ${copy.rate}: ${pattern?.rate ?? chordRate} · ${copy.patternStep}: ${pattern?.step ?? "—"}`;
    };
    scheduler.addEventListener("frame", renderFrame);

    rebuildWorkstation = async (): Promise<void> => {
      if (!scheduler || !audio) return;
      const snapshot = scheduler.snapshot();
      const canonicalPosition = transformed.studyToOriginal(snapshot.position);
      const loop = scheduler.getLoopRange();
      const canonicalLoop = loop ? [transformed.studyToOriginal(loop[0]), transformed.studyToOriginal(loop[1])] as const : null;
      const wasPlaying = snapshot.playing;
      scheduler.removeEventListener("frame", renderFrame);
      scheduler.pause();
      audio.destroy();
      scheduler.destroy();
      timingMode = transformState.timing;
      transformed = transformLearningTimeline(learningMelody.timeline, transformState);
      primaryIds = new Set(transformed.timeline.notes.map((note) => note.id));
      const pitchChanged = transformState.mode !== "original" || transformState.targetTonic != null || transformState.transpose !== 0;
      harmonies = pitchChanged || timingMode === "continuous" ? buildHarmonicTimeline(transformed.timeline) : canonicalHarmonies;
      arrangement = buildStudyArrangement(transformed.timeline, harmonies, selectedPart, studyVoices);
      melodyScore.setNotes(transformed.timeline.notes);
      playbackCoordinator.activate(transportId);
      scheduler = new CanonicalScheduler(arrangement);
      audio = new SchedulerAudioAdapter(scheduler);
      selectedInstrument = melodySound.value;
      audio.setInstrument(selectedInstrument as InstrumentName);
      audio.setHarmonicTimeline(harmonies);
      audio.setChordPattern(chordPattern, chordRate);
      updatePlaybackSelection();
      updateMix();
      scheduler.addEventListener("frame", renderFrame);
      scheduler.setTempo(snapshot.tempoPercent);
      if (canonicalLoop) scheduler.setLoop(transformed.originalToStudy(canonicalLoop[0]), transformed.originalToStudy(canonicalLoop[1]));
      scheduler.seek(transformed.originalToStudy(canonicalPosition));
      seek.max = String(arrangement.durationSeconds);
      await selectInstrument(selectedInstrument);
      const key = describeStudyKey(transformState);
      host.querySelector<HTMLOutputElement>('[data-l="transpose-value"]')!.value = `${key.semitones >= 0 ? "+" : ""}${key.semitones} st`;
      host.querySelector<HTMLOutputElement>('[data-l="key-status"]')!.value = `Original: ${key.source} · Study: ${key.study}`;
      if (wasPlaying) { try { await audio.enable(); scheduler.play(); } catch (error) { host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error); } }
    };
    const segmentMap = host.querySelector<HTMLElement>('[data-l="segment-map"]')!;
    const renderSegmentMap = (): void => {
      segmentMap.replaceChildren();
      for (const segment of learningMelody.segments) {
        const row = document.createElement("label");
        row.className = "learning-segment-row";
        const text = document.createElement("span");
        text.textContent = `${formatClock(segment.startSeconds)}–${formatClock(segment.endSeconds)} · ${segment.provenance}${segment.retainedRest ? " · retained rest" : ""}`;
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Source for ${text.textContent}`);
        select.append(new Option("Retain musical rest", ""), ...lanes.map((lane) => new Option(lane.label, lane.id, false, lane.id === segment.sourceLaneId)));
        select.value = segment.sourceLaneId ?? "";
        select.onchange = () => {
          const lane = lanes.find((entry) => entry.id === select.value);
          void installLearningMelody(lane ? replaceLearningSegmentSource(learningMelody, segment.id, lane) : retainLearningSegmentRest(learningMelody, segment.id));
        };
        row.append(text, select); segmentMap.append(row);
      }
      const d = learningMelody.diagnostics;
      host.querySelector<HTMLElement>('[data-l="continuity"]')!.textContent = `Duration ${formatClock(d.durationSeconds)} · notes ${d.noteCount} · range ${d.pitchMin == null ? "—" : noteLabel(d.pitchMin)}–${d.pitchMax == null ? "—" : noteLabel(d.pitchMax)} · median gap ${d.medianSilentGapSeconds.toFixed(2)}s · longest unintended gap ${d.longestUnintendedGapSeconds.toFixed(2)}s · monophony ${Math.round(d.monophonyRatio * 100)}% · ${d.continuityWarning ? "review long gaps" : "continuous"}`;
    };
    const installLearningMelody = async (next: LearningMelody): Promise<void> => {
      learningMelody = next;
      renderSegmentMap();
      await rebuildWorkstation();
    };
    applySessionMelody = (track) => {
      const manualLane: VoiceLane = { id: `session:${track.sourceId}:${track.trackIndex}`, label: `${track.sourceName} · Track ${track.trackIndex + 1} · manual`, partId: `session-${track.trackIndex}`, partName: track.name || "Manual reference", staff: null, voice: String(track.trackIndex + 1), inferred: false, notes: track.notes.map((note) => ({ ...note, partId: `session-${track.trackIndex}` })) };
      host.querySelector<HTMLElement>('[data-l="melody-source"]')!.textContent = `${track.sourceName} · Track ${track.trackIndex + 1} · MANUAL`;
      void installLearningMelody(composeLearningMelody(canonicalTimeline, [manualLane, ...lanes], { primaryLane: manualLane, manualPrimary: true }));
    };
    applyGapFill = (track) => {
      const gapLane: VoiceLane = { id: `gap:${track.sourceId}:${track.trackIndex}`, label: `${track.sourceName} · Track ${track.trackIndex + 1} · gap fill`, partId: `gap-${track.trackIndex}`, partName: track.name || "Gap-fill reference", staff: null, voice: String(track.trackIndex + 1), inferred: false, notes: track.notes.map((note) => ({ ...note, partId: `gap-${track.trackIndex}` })) };
      void installLearningMelody(composeLearningMelody(canonicalTimeline, [gapLane, ...lanes], { primaryLane: melodyLane, gapFillLane: gapLane }));
    };
    renderSegmentMap();
    host.querySelector<HTMLElement>('[data-l="melody-source"]')!.textContent = melodyLane ? `canonical · ${melodyLane.label} · ${melodyLane.inferred ? "INFERRED" : "VERIFIED"}` : "Unavailable";
    const pressGroup = (selector: string, value: string, dataName: string): void => {
      host.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[dataName] === value)));
    };
    if (initialTrackResolution.usedFallback) activeTrackSelect.value = initialActiveTrack?.id ?? "";
    activeTrackSelect.onchange = () => {
      const resolution = resolveActiveTrack(activeTrackSelect.value as ActiveTrackId, activeTrackOptions);
      if (!resolution.option) return;
      selectedTrackId = resolution.option.id;
      selectedPart = resolution.option.arrangementPart;
      selectedLaneIds = new Set([resolution.option.lane.id]);
      voiceList.querySelectorAll<HTMLInputElement>("[data-lane]").forEach((input) => { input.checked = selectedLaneIds.has(input.value); });
      selectedStaffScope = resolveStaffScope(selectedStaffScope, staffScopeSupport(resolution.option));
      updateStaffControls();
      persistSelection();
      host.querySelector<HTMLElement>('[data-l="melody-source"]')!.textContent = `active · ${resolution.option.lane.label}${resolution.usedFallback ? " · fallback" : ""}`;
      void installLearningMelody(composeLearningMelody(canonicalTimeline, lanes, { primaryLane: resolution.option.lane }));
    };
    host.querySelectorAll<HTMLButtonElement>("[data-staff-scope]").forEach((button) => {
      button.onclick = () => {
        const requested = button.dataset.staffScope as StaffScope;
        const support = staffScopeSupport(currentTrackOption());
        if (!support[requested]) return;
        selectedStaffScope = requested;
        updateStaffControls();
        persistSelection();
        updatePlaybackSelection();
      };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((button) => {
      button.onclick = () => {
        playbackMode.value = button.dataset.play ?? "solo";
        pressGroup("[data-play]", playbackMode.value, "play");
        chordControls.hidden = playbackMode.value !== "chords";
        host.querySelector<HTMLElement>('[data-l="voices-group"]')!.hidden = playbackMode.value !== "solo";
        accompaniment = playbackMode.value === "chords";
        chordsToggle.checked = accompaniment;
        pressGroup("[data-accompaniment]", accompaniment ? "on" : "off", "accompaniment");
        updatePlaybackSelection();
        updateHarmonyAtCurrentPosition();
      };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-voices]").forEach((button) => {
      button.onclick = () => {
        studyVoices = Number(button.dataset.voices) as StudyVoiceCount;
        pressGroup("[data-voices]", String(studyVoices), "voices");
        void rebuildWorkstation();
      };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach((button) => {
      button.onclick = () => {
        melodySound.value = button.dataset.sound ?? "piano";
        pressGroup("[data-sound]", melodySound.value, "sound");
        void selectInstrument(melodySound.value);
      };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-timing]").forEach((button) => {
      button.onclick = () => {
        timingMode = button.dataset.timing as LearningTiming;
        transformState = { ...transformState, timing: timingMode };
        pressGroup("[data-timing]", timingMode, "timing");
        void rebuildWorkstation();
      };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-transpose]").forEach((button) => {
      button.onclick = () => { transformState = { ...transformState, transpose: transformState.transpose + Number(button.dataset.transpose) }; void rebuildWorkstation(); };
    });
    host.querySelector<HTMLButtonElement>("[data-transpose-reset]")!.onclick = () => {
      transformState = { ...transformState, transpose: 0, targetTonic: null, mode: "original" };
      host.querySelector<HTMLSelectElement>('[data-l="target-key"]')!.value = "";
      pressGroup("[data-mode]", "original", "mode");
      void rebuildWorkstation();
    };
    host.querySelector<HTMLSelectElement>('[data-l="target-key"]')!.onchange = (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      transformState = { ...transformState, targetTonic: value === "" ? null : Number(value) };
      void rebuildWorkstation();
    };
    host.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      button.onclick = () => { transformState = { ...transformState, mode: button.dataset.mode as StudyMode }; pressGroup("[data-mode]", transformState.mode, "mode"); void rebuildWorkstation(); };
    });
    host.querySelectorAll<HTMLButtonElement>("[data-accompaniment]").forEach((button) => {
      button.onclick = () => { accompaniment = button.dataset.accompaniment === "on"; chordsToggle.checked = accompaniment; pressGroup("[data-accompaniment]", accompaniment ? "on" : "off", "accompaniment"); updatePlaybackSelection(); };
    });
    const initialKey = describeStudyKey(transformState);
    host.querySelector<HTMLOutputElement>('[data-l="transpose-value"]')!.value = `${initialKey.semitones >= 0 ? "+" : ""}${initialKey.semitones} st`;
    host.querySelector<HTMLOutputElement>('[data-l="key-status"]')!.value = `Original: ${initialKey.source} · Study: ${initialKey.study}`;
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
    controller.abort(); disconnectMidi(); unregisterTransport(); removeScorePositionListener(); midiLabCleanup(); audio?.destroy(); scheduler?.destroy(); visualizer?.destroy(); auditionEngine?.destroy(); scoreCleanup(); host.remove();
  };
}
