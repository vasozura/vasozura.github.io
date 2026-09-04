import { appConfig } from "../config";
import { getSupabase } from "../lib/supabase";
import { mountScoreViewer } from "../score/score-viewer";
import type { AttemptResult, Exercise, ExerciseSelection, NoteEvent, ScoreManifest, Timeline } from "./contracts";
import { isLearningApiUnavailable, LearningApiClient, type LearningApi } from "./api-client";
import { SchedulerAudioAdapter } from "./audio-adapter";
import { AccordionVisualizer, GuitarVisualizer, isVerifiedAccordionConfig, PianoRangeVisualizer, type TimelineVisualizer } from "./instruments";
import { LocalLearningApi } from "./mock-api";
import { MidiAttemptRecorder } from "./practice";
import { CanonicalScheduler, type SchedulerFrame } from "./scheduler";
import { assessSynchronization, readMidiDuration } from "./sync-analysis";
import { connectWebMidi, supportsWebMidi } from "./web-midi";

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteLabel = (midi: number): string => `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected learning error.";
  const message = error.message;
  if (/401|auth/i.test(message)) return `Authorization: ${message}`;
  if (/timeout|network|fetch|reach/i.test(message)) return `Network: ${message}`;
  if (/parse|musicxml|midi/i.test(message)) return `Source parsing: ${message}`;
  return message;
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

function resultText(result: AttemptResult): string {
  return `Pitch ${Math.round(result.pitchScore)}% · timing ${Math.round(result.timingScore)}% · completion ${Math.round(result.completion)}% · streak ${result.streak}`;
}

async function countdown(beats: number, beatDurationMs: number, output: HTMLElement, signal: AbortSignal): Promise<void> {
  for (let remaining = beats; remaining > 0; remaining -= 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    output.textContent = `Starting in ${remaining}…`;
    await new Promise<void>((resolve) => window.setTimeout(resolve, beatDurationMs));
  }
}

export async function mountLearningMode(root: HTMLElement): Promise<() => void> {
  const scoreCleanup = await mountScoreViewer(root, { midiPlayback: false });
  const midiUrl = root.dataset.midiUrl;
  const songId = root.dataset.songId ?? "";
  if (root.dataset.learningEnabled !== "true" || !songId || (!appConfig.hasLearningApi && !midiUrl)) return scoreCleanup;

  const allowed = new Set((root.dataset.learningInstruments || "piano").split(",").filter(Boolean));
  const host = document.createElement("section");
  host.className = "learning-mode";
  host.setAttribute("aria-labelledby", "learning-mode-title");
  host.innerHTML = `
    <h3 id="learning-mode-title">Learning mode</h3>
    <p class="learning-clock-note">One canonical score clock drives sound, cursor, instruments, metronome and loops.</p>
    <p data-l="sync" class="learning-sync" aria-live="polite">Checking score/MIDI alignment…</p>
    <div class="learning-transport">
      <button type="button" data-l="play">Play</button><button type="button" data-l="pause">Pause</button><button type="button" data-l="stop">Stop</button>
      <button type="button" data-l="metronome" aria-pressed="false">Metronome</button>
      <label>Tempo <input data-l="tempo" type="range" min="50" max="150" value="100"><output>100%</output></label>
      <label>Position <input data-l="seek" type="range" min="0" max="0" value="0" step="0.01"></label>
      <label>Loop from measure <input data-l="loop-a" type="number" min="1" value="1"></label>
      <label>to <input data-l="loop-b" type="number" min="1" value="1"></label>
      <button type="button" data-l="loop">Set loop</button><button type="button" data-l="clear-loop">Clear loop</button>
      <output data-l="position">1 · 1</output>
    </div>
    <div class="learning-instruments" role="tablist" aria-label="Instrument view">
      ${allowed.has("piano") ? '<button type="button" role="tab" data-instrument="piano">Piano</button>' : ""}
      ${allowed.has("guitar") ? '<button type="button" role="tab" data-instrument="guitar">Guitar / TAB</button>' : ""}
      ${allowed.has("accordion") ? '<button type="button" role="tab" data-instrument="accordion">Accordion</button>' : ""}
    </div>
    <div class="learning-view-options"><label><input type="checkbox" data-l="follow" checked> Follow current note</label><label data-l="left-label" hidden><input type="checkbox" data-l="left"> Left-handed guitar</label></div>
    <p data-l="notes" class="learning-current">Current: — · Upcoming: —</p>
    <div data-l="visualizer" aria-live="off"></div>
    <section class="learning-practice" aria-labelledby="practice-title">
      <h4 id="practice-title">Practice exercise</h4>
      <div class="learning-exercise-options">
        <label>Instrument <select data-l="exercise-instrument">${[...allowed].map((name) => `<option value="${name}">${name}</option>`).join("")}</select></label>
        <label>From measure <input data-l="exercise-a" type="number" min="1" value="1"></label>
        <label>To measure <input data-l="exercise-b" type="number" min="1" value="1"></label>
        <label>Difficulty <select data-l="difficulty"><option value="70">Beginner</option><option value="85">Intermediate</option><option value="100" selected>Advanced</option></select></label>
        <label>Countdown <select data-l="countdown"><option value="0">Off</option><option value="2">2 beats</option><option value="4" selected>4 beats</option></select></label>
        <label>Practice mode <select data-l="practice-mode"><option value="listen">Listen</option><option value="wait-for-note">Wait for note (Web MIDI)</option><option value="continuous" selected>Continuous</option></select></label>
      </div>
      <button type="button" data-l="prepare">Prepare exercise</button><button type="button" data-l="midi" ${supportsWebMidi() ? "" : "disabled"}>Connect MIDI input</button><button type="button" data-l="practice" disabled>Start practice</button><button type="button" data-l="finish" disabled>Finish & score</button>
      <p class="learning-scoring">Scoring compares recorded MIDI pitch, onset and duration against the immutable exercise timeline using the API's versioned deterministic tolerances.</p>
      <p data-l="result" aria-live="polite"></p>
      <div data-l="feedback"></div>
      <div data-l="progress"></div><div data-l="history"></div>
      <button type="button" class="danger" data-l="reset">Reset my learning history</button>
    </section>
    <p data-l="status" aria-live="polite">Preparing canonical timeline…</p>`;
  root.append(host);

  const controller = new AbortController();
  let disconnectMidi = (): void => {};
  let audio: SchedulerAudioAdapter | null = null;
  let scheduler: CanonicalScheduler | null = null;
  let visualizer: TimelineVisualizer | null = null;
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

    scheduler = new CanonicalScheduler(manifest.timeline);
    audio = new SchedulerAudioAdapter(scheduler);
    const recorder = new MidiAttemptRecorder();
    const visualRoot = host.querySelector<HTMLElement>('[data-l="visualizer"]')!;
    const maxMeasure = Math.max(1, manifest.timeline.measures.length);
    host.querySelectorAll<HTMLInputElement>('[data-l="loop-a"],[data-l="loop-b"],[data-l="exercise-a"],[data-l="exercise-b"]').forEach((input) => { input.max = String(maxMeasure); });
    host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value = String(maxMeasure);
    host.querySelector<HTMLInputElement>('[data-l="exercise-b"]')!.value = String(maxMeasure);
    const seek = host.querySelector<HTMLInputElement>('[data-l="seek"]')!;
    seek.max = String(manifest.timeline.durationSeconds);
    const mapping = (() => { try { return JSON.parse(root.dataset.learningMapping || "{}"); } catch { return {}; } })() as Record<string, unknown>;
    const accordionConfig = isVerifiedAccordionConfig(mapping.accordion) ? mapping.accordion : null;
    let selectedInstrument = allowed.values().next().value ?? "piano";
    let piano: PianoRangeVisualizer | null = null;
    let guitar: GuitarVisualizer | null = null;
    let practicing = false;
    let reliable = true;
    let practiceStartedAtMs = 0;
    let exercise: Exercise | null = null;
    let waitingForMidi = false;
    let expectedMidi = new Set<number>();

    const selectInstrument = (name: string): void => {
      selectedInstrument = name;
      visualizer?.destroy();
      visualRoot.className = "";
      piano = name === "piano" ? new PianoRangeVisualizer(visualRoot, manifest.timeline.notes) : null;
      guitar = name === "guitar" ? new GuitarVisualizer(visualRoot) : null;
      visualizer = piano ?? guitar ?? new AccordionVisualizer(visualRoot, accordionConfig);
      visualizer.mount();
      host.querySelectorAll<HTMLButtonElement>("[data-instrument]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.instrument === name)));
      host.querySelector<HTMLElement>('[data-l="left-label"]')!.hidden = name !== "guitar";
    };
    selectInstrument(selectedInstrument);
    host.querySelectorAll<HTMLButtonElement>("[data-instrument]").forEach((button) => { button.onclick = () => selectInstrument(button.dataset.instrument ?? "piano"); });
    host.querySelector<HTMLInputElement>('[data-l="follow"]')!.onchange = (event) => piano?.setFollow((event.currentTarget as HTMLInputElement).checked);
    host.querySelector<HTMLInputElement>('[data-l="left"]')!.onchange = (event) => guitar?.setLeftHanded((event.currentTarget as HTMLInputElement).checked);

    host.querySelector<HTMLButtonElement>('[data-l="play"]')!.onclick = () => { void audio?.enable(); scheduler?.play(); };
    host.querySelector<HTMLButtonElement>('[data-l="pause"]')!.onclick = () => scheduler?.pause();
    host.querySelector<HTMLButtonElement>('[data-l="stop"]')!.onclick = () => { scheduler?.stop(); audio?.reset(); };
    seek.oninput = () => { scheduler?.seek(Number(seek.value)); audio?.reset(); };
    host.querySelector<HTMLInputElement>('[data-l="tempo"]')!.oninput = (event) => { const input = event.currentTarget as HTMLInputElement; scheduler?.setTempo(Number(input.value)); input.nextElementSibling!.textContent = `${input.value}%`; };
    host.querySelector<HTMLButtonElement>('[data-l="loop"]')!.onclick = () => scheduler?.setMeasureLoop(Number(host.querySelector<HTMLInputElement>('[data-l="loop-a"]')!.value) - 1, Number(host.querySelector<HTMLInputElement>('[data-l="loop-b"]')!.value) - 1);
    host.querySelector<HTMLButtonElement>('[data-l="clear-loop"]')!.onclick = () => scheduler?.setLoop(null, null);
    host.querySelector<HTMLButtonElement>('[data-l="metronome"]')!.onclick = (event) => { const button = event.currentTarget as HTMLButtonElement; const enabled = button.getAttribute("aria-pressed") !== "true"; button.setAttribute("aria-pressed", String(enabled)); audio?.setMetronome(enabled); };

    try {
      const assessment = assessSynchronization(manifest.timeline, await readMidiDuration(midiUrl, fetch));
      const sync = host.querySelector<HTMLElement>('[data-l="sync"]')!;
      sync.textContent = `${assessment.confidence.toUpperCase()} synchronization · ${assessment.message}`;
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
            if (waitingForMidi && expectedMidi.has(message.midi)) { waitingForMidi = false; scheduler?.play(); }
          } else recorder.noteOff(message.midi, message.atMs);
        });
        button.textContent = "MIDI connected";
      } catch (error) { button.textContent = errorMessage(error); button.disabled = false; }
    };

    const prepare = host.querySelector<HTMLButtonElement>('[data-l="prepare"]')!;
    const practice = host.querySelector<HTMLButtonElement>('[data-l="practice"]')!;
    const finish = host.querySelector<HTMLButtonElement>('[data-l="finish"]')!;
    prepare.onclick = async () => {
      prepare.disabled = true;
      const result = host.querySelector<HTMLElement>('[data-l="result"]')!;
      result.textContent = "Generating deterministic exercise…";
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
        result.textContent = `Exercise ready · measures ${selection.fromMeasure}–${selection.toMeasure} · ${selection.tempoPercent}%`;
        practice.disabled = false;
      } catch (error) { result.textContent = `${errorMessage(error)} Select Prepare exercise to retry safely.`; }
      finally { prepare.disabled = false; }
    };

    practice.onclick = async () => {
      if (!exercise) return;
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
      await countdown(countdownBeats, 60_000 / (activeTempo * exercise.tempoPercent / 100), result, controller.signal);
      scheduler!.play(); practice.disabled = true; finish.disabled = false;
      result.textContent = exercise.mode === "listen" ? "Listen mode started." : exercise.mode === "wait-for-note" && !supportsWebMidi() ? "Web MIDI is unavailable; continuous fallback started." : "Practice recording started.";
    };

    finish.onclick = async () => {
      if (!exercise) return;
      practicing = false; scheduler!.pause(); finish.disabled = true;
      const resultOutput = host.querySelector<HTMLElement>('[data-l="result"]')!;
      resultOutput.textContent = "Evaluating attempt…";
      try {
        const events = recorder.result();
        const first = events[0]?.startedAtMs ?? 0;
        const result = await api.evaluate(exercise.id, events.map((event) => ({ ...event, startedAtMs: event.startedAtMs - first })), crypto.randomUUID(), controller.signal);
        if (!reliable) result.pausedForTiming = true;
        const session = await getSupabase()?.auth.getSession();
        if (usingLocalAdapter || session?.data.session) await api.saveProgress({ songId, userId: session?.data.session?.user.id ?? null, completedExercises: result.completion >= 80 ? 1 : 0, bestScore: Math.round((result.pitchScore + result.timingScore + result.durationScore) / 3), streak: result.streak, practiceSeconds: Math.max(0, (performance.now() - practiceStartedAtMs) / 1000), lastPracticedAt: new Date().toISOString() }, controller.signal);
        resultOutput.textContent = result.pausedForTiming ? "Timing score paused because the tab was throttled." : resultText(result);
        const feedbackRoot = host.querySelector<HTMLElement>('[data-l="feedback"]')!;
        feedbackRoot.replaceChildren();
        const actionable = result.feedback.filter((item) => item.status !== "correct").slice(0, 50);
        if (actionable.length) {
          const title = document.createElement("h5"); title.textContent = "Note feedback";
          const list = document.createElement("ol");
          actionable.forEach((item) => {
            const row = document.createElement("li");
            const expected = item.expectedMidi == null ? "—" : noteLabel(item.expectedMidi);
            const played = item.playedMidi == null ? "—" : noteLabel(item.playedMidi);
            row.textContent = `${item.status.replace("_", " ")} · measure ${item.measureNumber ?? "—"}, beat ${item.beat ?? "—"} · expected ${expected}, played ${played}${item.onsetDeltaMs == null ? "" : ` · ${item.onsetDeltaMs > 0 ? "+" : ""}${item.onsetDeltaMs} ms`}`;
            list.append(row);
          });
          feedbackRoot.append(title, list);
        }
        await refreshHistory();
      } catch (error) { resultOutput.textContent = `${errorMessage(error)} You can finish again to retry safely.`; finish.disabled = false; return; }
      practice.disabled = false;
    };

    const refreshHistory = async (): Promise<void> => {
      const session = await getSupabase()?.auth.getSession();
      if (!usingLocalAdapter && !session?.data.session) {
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = "Sign in to save private progress.";
        host.querySelector<HTMLButtonElement>('[data-l="reset"]')!.hidden = true;
        return;
      }
      try {
        const [progress, history] = await Promise.all([api.progress(songId, controller.signal), api.history(songId, controller.signal)]);
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = `Attempts ${progress.attempts} · best ${progress.bestScore == null ? "—" : `${Math.round(progress.bestScore)}%`} · recent ${progress.recentScore == null ? "—" : `${Math.round(progress.recentScore)}%`} · streak ${progress.streak}`;
        host.querySelector<HTMLElement>('[data-l="history"]')!.innerHTML = history.length ? `<h5>Recent attempts</h5><ol>${history.map((item) => `<li>${new Date(item.evaluatedAt).toLocaleString()} · pitch ${Math.round(item.pitchScore)}% · timing ${Math.round(item.timingScore)}%</li>`).join("")}</ol>` : "<p>No attempts recorded yet.</p>";
        const perInstrument = [...allowed].map((instrument) => {
          const matching = history.filter((item) => item.instruments.includes(instrument));
          const best = matching.length ? Math.max(...matching.map((item) => (item.pitchScore + item.timingScore) / 2)) : null;
          return `${instrument}: ${matching.length} attempt${matching.length === 1 ? "" : "s"}${best == null ? "" : ` · best ${Math.round(best)}%`}`;
        });
        host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent += ` · ${perInstrument.join(" · ")}`;
      } catch (error) { host.querySelector<HTMLElement>('[data-l="progress"]')!.textContent = `${errorMessage(error)} Progress can be retried after reconnecting.`; }
    };

    host.querySelector<HTMLButtonElement>('[data-l="reset"]')!.onclick = async () => {
      if (!window.confirm("Delete only your attempts and progress for this song? This cannot be undone.")) return;
      const result = await api.reset(songId, controller.signal);
      host.querySelector<HTMLElement>('[data-l="result"]')!.textContent = `Deleted ${result.deletedAttempts} attempts and ${result.deletedProgressEntries} progress entries.`;
      await refreshHistory();
    };

    scheduler.addEventListener("frame", (event) => {
      const frame = (event as CustomEvent<SchedulerFrame>).detail;
      reliable = reliable && frame.reliable;
      visualizer?.render(frame.active, frame.upcoming);
      expectedMidi = new Set(frame.active.map((note) => note.midi));
      if (practicing && exercise?.mode === "wait-for-note" && supportsWebMidi() && frame.playing && frame.active.length) { waitingForMidi = true; scheduler?.pause(); }
      const cursorNote = frame.active[0] ?? frame.upcoming[0];
      if (cursorNote) root.dispatchEvent(new CustomEvent("learning-score-cursor", { detail: { cursorStep: cursorNote.cursorStep ?? manifest.timeline.notes.indexOf(cursorNote) } }));
      host.querySelector<HTMLOutputElement>('[data-l="position"]')!.value = `${(frame.measure?.index ?? 0) + 1} · ${Math.max(1, Math.floor(frame.beat))}`;
      seek.value = String(frame.position);
      host.querySelector<HTMLElement>('[data-l="notes"]')!.textContent = `Current: ${frame.active.map((note) => `${noteLabel(note.midi)}${note.hand === "unknown" ? "" : ` (${note.hand})`}`).join(" + ") || "—"} · Upcoming: ${frame.upcoming.slice(0, 4).map((note) => noteLabel(note.midi)).join(", ") || "—"}`;
    });

    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = usingLocalAdapter ? (appConfig.hasLearningApi ? "Learning API unavailable; using the versioned local adapter." : "Using the versioned local learning adapter.") : "Learning API connected.";
    await refreshHistory();
  } catch (error) {
    host.querySelector<HTMLElement>('[data-l="status"]')!.textContent = errorMessage(error);
  }

  return () => {
    controller.abort(); disconnectMidi(); audio?.destroy(); scheduler?.destroy(); visualizer?.destroy(); scoreCleanup(); host.remove();
  };
}
