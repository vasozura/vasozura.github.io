import { appConfig } from "../config";
import { getSupabase } from "../lib/supabase";
import { mountScoreViewer } from "../score/score-viewer";
import type { AttemptResult, Exercise, NoteEvent, ScoreManifest, Timeline } from "./contracts";
import { LearningApiClient, type LearningApi } from "./api-client";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { AccordionVisualizer, GuitarVisualizer, Piano88Visualizer, type TimelineVisualizer } from "./instruments";
import { LocalLearningApi } from "./mock-api";
import { MidiAttemptRecorder } from "./practice";
import { CanonicalScheduler, type SchedulerFrame } from "./scheduler";
import { connectWebMidi, supportsWebMidi } from "./web-midi";

async function manifestFromMidi(songId: string, url: string): Promise<ScoreManifest> {
  const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), fetch(url)]);
  if (!response.ok) throw new Error(`MIDI unavailable (${response.status})`);
  const midi = new Midi(await response.arrayBuffer());
  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const measureLength = 60 / bpm * 4;
  const notes: NoteEvent[] = midi.tracks.flatMap((track, trackIndex) => track.notes.map((note, noteIndex): NoteEvent => ({ id: `t${trackIndex}n${noteIndex}`, partId: `track-${trackIndex}`, measureIndex: Math.max(0, Math.floor(note.time / measureLength)), beat: 1 + note.time % measureLength / (measureLength / 4), startSeconds: note.time, durationSeconds: note.duration, midi: note.midi, velocity: note.velocity, hand: trackIndex === 0 ? "right" : "unknown" }))).sort((a, b) => a.startSeconds - b.startSeconds).map((note, cursorStep) => ({ ...note, cursorStep }));
  const count = Math.max(1, Math.ceil(midi.duration / measureLength));
  const timeline: Timeline = { version: "v1", durationSeconds: midi.duration, notes: notes.sort((a, b) => a.startSeconds - b.startSeconds), tempos: [{ atSeconds: 0, bpm, measureIndex: 0 }], timeSignatures: [{ atSeconds: 0, beats: 4, beatType: 4, measureIndex: 0 }], measures: Array.from({ length: count }, (_, index) => ({ index, number: String(index + 1), startSeconds: index * measureLength, durationSeconds: Math.min(measureLength, Math.max(0, midi.duration - index * measureLength)), beats: 4, beatType: 4, pickup: false })) };
  return { version: "v1", songId, sourceChecksum: "local-midi", generatedAt: new Date(0).toISOString(), parts: midi.tracks.map((track, index) => ({ id: `track-${index}`, name: track.name || `Track ${index + 1}`, instrument: track.instrument.name, midiChannel: track.channel, hand: index === 0 ? "right" : "unknown" })), timeline, warnings: ["Local deterministic MIDI adapter; backend analysis unavailable."] };
}

function resultText(result: AttemptResult): string {
  return `Pitch ${Math.round(result.pitchScore)}% · timing ${Math.round(result.timingScore)}% · completion ${Math.round(result.completion)}% · streak ${result.streak}`;
}

export async function mountLearningMode(root: HTMLElement): Promise<() => void> {
  await mountScoreViewer(root);
  const midiUrl = root.dataset.midiUrl;
  const songId = root.dataset.songId ?? "";
  if (root.dataset.learningEnabled !== "true" || !midiUrl || !songId) return () => {};
  const legacyPiano = root.querySelector<HTMLElement>(".piano-keyboard");
  if (legacyPiano) legacyPiano.hidden = true;

  const allowed = new Set((root.dataset.learningInstruments || "piano").split(",").filter(Boolean));
  const host = document.createElement("section");
  host.className = "learning-mode";
  host.setAttribute("aria-labelledby", "learning-mode-title");
  host.innerHTML = `<h3 id="learning-mode-title">Learning mode</h3><div class="learning-transport"><button data-l="play">Play</button><button data-l="pause">Pause</button><button data-l="stop">Stop</button><button data-l="metronome" aria-pressed="false">Metronome</button><label>Tempo <input data-l="tempo" type="range" min="50" max="150" value="100"><output>100%</output></label><label>Loop from measure <input data-l="loop-a" type="number" min="1" value="1"></label><label>to <input data-l="loop-b" type="number" min="1" value="1"></label><button data-l="loop">Set loop</button><button data-l="clear-loop">Clear</button><output data-l="position">1 · 1</output></div><div class="learning-instruments" role="tablist" aria-label="Instrument view">${allowed.has("piano") ? '<button role="tab" data-instrument="piano">Piano</button>' : ""}${allowed.has("guitar") ? '<button role="tab" data-instrument="guitar">Guitar suggestions</button>' : ""}${allowed.has("accordion") ? '<button role="tab" data-instrument="accordion">Accordion</button>' : ""}</div><div data-l="visualizer" aria-live="off"></div><div class="learning-practice"><label>Practice mode <select data-l="practice-mode"><option value="listen">Listen</option><option value="wait-for-note">Wait for note</option><option value="continuous" selected>Continuous</option></select></label><button data-l="midi" ${supportsWebMidi() ? "" : "disabled"}>Connect MIDI input</button><button data-l="practice">Start practice</button><button data-l="finish" disabled>Finish & score</button><p data-l="result" aria-live="polite"></p></div><p data-l="status" aria-live="polite">Preparing canonical timeline…</p>`;
  root.append(host);

  const controller = new AbortController();
  let disconnectMidi = (): void => {};
  try {
    let api: LearningApi;
    let manifest: ScoreManifest;
    if (appConfig.hasLearningApi) {
      api = new LearningApiClient(appConfig.learningApiUrl);
      manifest = await api.manifest(songId, controller.signal);
    } else {
      manifest = await manifestFromMidi(songId, midiUrl);
      api = new LocalLearningApi({ [songId]: manifest });
    }
    const [exercise] = await api.exercises(songId, controller.signal);
    const scheduler = new CanonicalScheduler(manifest.timeline);
    const audio = new SchedulerAudioAdapter(scheduler);
    const recorder = new MidiAttemptRecorder();
    const visualRoot = host.querySelector<HTMLElement>('[data-l="visualizer"]')!;
    const firstInstrument = allowed.values().next().value ?? "piano";
    let visualizer: TimelineVisualizer = new Piano88Visualizer(visualRoot);
    let practicing = false;
    let reliable = true;

    const select = (name: string): void => {
      visualizer.destroy();
      visualRoot.className = "";
      visualizer = name === "guitar" ? new GuitarVisualizer(visualRoot) : name === "accordion" ? new AccordionVisualizer(visualRoot, { rightHandMidi: Array.from({ length: 41 }, (_, index) => 48 + index), bassButtons: [{ id: "C", midi: 36 }, { id: "G", midi: 43 }, { id: "F", midi: 41 }] }) : new Piano88Visualizer(visualRoot);
      visualizer.mount();
      host.querySelectorAll<HTMLButtonElement>("[data-instrument]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.instrument === name)));
    };
    select(firstInstrument);
    host.querySelectorAll<HTMLButtonElement>("[data-instrument]").forEach((button) => { button.onclick = () => select(button.dataset.instrument ?? "piano"); });
    host.querySelector<HTMLButtonElement>('[data-l="play"]')!.onclick = () => { void audio.enable(); scheduler.play(); };
    host.querySelector<HTMLButtonElement>('[data-l="pause"]')!.onclick = () => scheduler.pause();
    host.querySelector<HTMLButtonElement>('[data-l="stop"]')!.onclick = () => scheduler.stop();
    host.querySelector<HTMLInputElement>('[data-l="tempo"]')!.oninput = (event) => { const input = event.currentTarget as HTMLInputElement; scheduler.setTempo(Number(input.value)); input.nextElementSibling!.textContent = `${input.value}%`; };
    host.querySelector<HTMLButtonElement>('[data-l="loop"]')!.onclick = () => { const a = Number(host.querySelector<HTMLInputElement>('[data-l="loop-a"]')!.value) - 1; const b = Number(host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value) - 1; scheduler.setMeasureLoop(a, b); };
    host.querySelector<HTMLButtonElement>('[data-l="clear-loop"]')!.onclick = () => scheduler.setLoop(null, null);
    host.querySelector<HTMLButtonElement>('[data-l="metronome"]')!.onclick = (event) => { const button = event.currentTarget as HTMLButtonElement; const enabled = button.getAttribute("aria-pressed") !== "true"; button.setAttribute("aria-pressed", String(enabled)); audio.setMetronome(enabled); };
    host.querySelector<HTMLButtonElement>('[data-l="midi"]')!.onclick = async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try { disconnectMidi = await connectWebMidi((message) => { if (!practicing) return; if (message.on) recorder.noteOn(message.midi, message.velocity, message.atMs); else recorder.noteOff(message.midi, message.atMs); }); button.textContent = "MIDI connected"; }
      catch (error) { button.textContent = error instanceof Error ? error.message : "MIDI connection failed"; button.disabled = false; }
    };
    const practice = host.querySelector<HTMLButtonElement>('[data-l="practice"]')!;
    const finish = host.querySelector<HTMLButtonElement>('[data-l="finish"]')!;
    practice.onclick = () => { recorder.clear(); practicing = true; reliable = scheduler.snapshot().reliable; exercise.mode = host.querySelector<HTMLSelectElement>('[data-l="practice-mode"]')!.value as Exercise["mode"]; scheduler.seek(manifest.timeline.measures[exercise.fromMeasure]?.startSeconds ?? 0); void audio.enable(); scheduler.play(4); practice.disabled = true; finish.disabled = false; host.querySelector<HTMLElement>('[data-l="result"]')!.textContent = exercise.mode === "listen" ? "Listen mode started." : "Practice recording started."; };
    finish.onclick = async () => { practicing = false; scheduler.pause(); const events = recorder.result(); const shifted = events.map((event) => ({ ...event, startedAtMs: event.startedAtMs - (events[0]?.startedAtMs ?? 0) })); const result = appConfig.hasLearningApi ? await api.evaluate(exercise.id, shifted, crypto.randomUUID(), controller.signal) : await (api as LocalLearningApi).evaluate(exercise.id, shifted); if (!reliable) result.pausedForTiming = true; const session = await getSupabase()?.auth.getSession(); if (!appConfig.hasLearningApi || session?.data.session) await api.saveProgress({ songId, userId: session?.data.session?.user.id ?? null, completedExercises: result.completion >= 80 ? 1 : 0, bestScore: Math.round((result.pitchScore + result.timingScore + result.durationScore) / 3), streak: result.streak, lastPracticedAt: new Date().toISOString() }, controller.signal); host.querySelector<HTMLElement>('[data-l="result"]')!.textContent = result.pausedForTiming ? "Timing score paused because the tab was throttled." : resultText(result); practice.disabled = false; finish.disabled = true; };
    scheduler.addEventListener("frame", (event) => { const frame = (event as CustomEvent<SchedulerFrame>).detail; reliable = reliable && frame.reliable; visualizer.render(frame.active, frame.upcoming); const cursorNote = frame.active[0] ?? frame.upcoming[0]; if (cursorNote) root.dispatchEvent(new CustomEvent("learning-score-cursor", { detail: { cursorStep: cursorNote.cursorStep ?? manifest.timeline.notes.indexOf(cursorNote) } })); host.querySelector<HTMLOutputElement>('[data-l="position"]')!.value = `${(frame.measure?.index ?? 0) + 1} · ${Math.max(1, Math.floor(frame.beat))}`; });
    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = appConfig.hasLearningApi ? "Learning API connected." : "Using the versioned local learning adapter.";
    return () => { controller.abort(); disconnectMidi(); audio.destroy(); scheduler.destroy(); visualizer.destroy(); host.remove(); if (legacyPiano) legacyPiano.hidden = false; };
  } catch (error) {
    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = error instanceof Error ? error.message : "Learning mode unavailable";
    return () => { controller.abort(); disconnectMidi(); host.remove(); if (legacyPiano) legacyPiano.hidden = false; };
  }
}
