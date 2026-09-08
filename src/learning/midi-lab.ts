import { MidiPlayback } from "../score/midi-playback";
import { inspectMidiSource, parseMidiFiles, activeTimelineForTrack, chooseSessionMelody, compareTrack, melodyContourPoints, type InspectedMidiSource, type InspectedMidiTrack, type MidiLike } from "./midi-inspector";
import type { NoteEvent, Timeline } from "./contracts";

export interface MidiLabOptions { canonicalUrl?: string; canonicalTimeline: Timeline; onSessionMelody?: (track: InspectedMidiTrack) => void; }

const noteName = (midi: number): string => `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
const clock = (seconds: number): string => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export async function mountMidiLab(root: HTMLElement, options: MidiLabOptions): Promise<() => void> {
  root.innerHTML = `<section class="midi-lab" aria-labelledby="midi-lab-title">
    <div class="midi-lab-heading"><div><p class="eyebrow">LOCAL SESSION REFERENCES</p><h4 id="midi-lab-title">MIDI LAB</h4></div><label class="button midi-file-button">Load reference MIDI files<input data-midi-lab="files" type="file" multiple accept=".mid,.midi,audio/midi,audio/x-midi"></label></div>
    <p class="midi-lab-privacy">Files stay in this browser session. Nothing is uploaded or saved.</p>
    <div class="midi-lab-source"><button type="button" data-midi-lab="previous">← Previous source</button><select data-midi-lab="source" aria-label="MIDI source"></select><button type="button" data-midi-lab="next">Next source →</button><select data-midi-lab="relation"><option value="independent">Independent</option><option value="aligned">Aligned</option></select></div>
    <p data-midi-lab="alignment" class="midi-lab-message"></p>
    <div class="midi-lab-selection"><span>VOCAL / MELODY SOURCE</span><strong data-midi-lab="selection">No verified vocal MIDI track selected.</strong><small data-midi-lab="selection-kind"></small></div>
    <div class="midi-lab-toolbar"><label>Track <select data-midi-lab="track"></select></label><label>Sound <select data-midi-lab="sound"><option value="piano">Piano</option><option value="guitar">Guitar</option></select></label><button type="button" data-midi-lab="solo">▶ Solo</button><button type="button" data-midi-lab="stop">■ Stop</button><button type="button" data-midi-lab="active">Active</button><button type="button" data-midi-lab="use">Use as session melody</button></div>
    <div class="midi-contour"><svg data-midi-lab="contour" role="img" aria-label="Selected MIDI melody pitch contour"></svg><p data-midi-lab="current">Current note: — · Next: —</p></div>
    <p data-midi-lab="duration"></p><p data-midi-lab="diagnostics"></p>
    <div class="midi-track-scroll"><table class="midi-track-table"><thead><tr><th>Source</th><th>Track</th><th>Name</th><th>Instrument</th><th>Channel</th><th>Notes</th><th>Duration</th><th>Range</th><th>Texture</th><th>Avg gap</th><th>Suggestion</th><th>Actions</th></tr></thead><tbody data-midi-lab="tracks"></tbody></table></div>
  </section>`;
  const files = root.querySelector<HTMLInputElement>('[data-midi-lab="files"]')!;
  const sourceSelect = root.querySelector<HTMLSelectElement>('[data-midi-lab="source"]')!;
  const trackSelect = root.querySelector<HTMLSelectElement>('[data-midi-lab="track"]')!;
  const sound = root.querySelector<HTMLSelectElement>('[data-midi-lab="sound"]')!;
  const relation = root.querySelector<HTMLSelectElement>('[data-midi-lab="relation"]')!;
  const rows = root.querySelector<HTMLTableSectionElement>('[data-midi-lab="tracks"]')!;
  const contour = root.querySelector<SVGSVGElement>('[data-midi-lab="contour"]')!;
  let sources: InspectedMidiSource[] = [];
  let sourceIndex = 0;
  let manual: InspectedMidiTrack | null = null;
  let currentTrack: InspectedMidiTrack | null = null;
  let activeResult: ReturnType<typeof activeTimelineForTrack> | null = null;
  let activeMode = false;
  let playbackNotes: NoteEvent[] = [];

  const player = new MidiPlayback((active) => {
    const position = player.getPosition();
    const nextNote = playbackNotes.find((note) => note.startSeconds > position);
    root.querySelector<HTMLElement>('[data-midi-lab="current"]')!.textContent = `Current note: ${active.map(noteName).join(" ") || "—"} · Next: ${nextNote ? noteName(nextNote.midi) : "—"} · Track: ${currentTrack ? `${currentTrack.name} · Track ${currentTrack.trackIndex + 1}` : "—"}`;
    contour.querySelectorAll<SVGElement>("[data-active]").forEach((node) => node.removeAttribute("data-active"));
    playbackNotes.forEach((note, index) => { if (active.includes(note.midi) && Math.abs(note.startSeconds - position) < 1) contour.querySelector<SVGElement>(`[data-note-index="${index}"]`)?.setAttribute("data-active", "true"); });
  }, () => undefined);

  const renderContour = (track: InspectedMidiTrack): void => {
    contour.replaceChildren();
    contour.setAttribute("viewBox", "0 0 1000 180");
    const min = track.pitchMin ?? 0;
    const max = Math.max(min + 1, track.pitchMax ?? min + 1);
    melodyContourPoints(track).forEach((note, index) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(note.startSeconds / Math.max(0.01, track.durationSeconds) * 980 + 10));
      rect.setAttribute("y", String(160 - (note.midi - min) / (max - min) * 140));
      rect.setAttribute("width", String(Math.max(2, note.durationSeconds / Math.max(0.01, track.durationSeconds) * 980)));
      rect.setAttribute("height", "5");
      rect.dataset.noteIndex = String(index);
      rect.setAttribute("aria-label", noteName(note.midi));
      contour.append(rect);
    });
  };

  const selectedSource = (): InspectedMidiSource | null => sources[sourceIndex] ?? null;
  const selectedTrack = (): InspectedMidiTrack | null => selectedSource()?.tracks[Number(trackSelect.value)] ?? null;
  const loadTrack = (track: InspectedMidiTrack, active: boolean): void => {
    currentTrack = track;
    activeMode = active;
    const source = sources.find((entry) => entry.id === track.sourceId)!;
    activeResult = activeTimelineForTrack(track, source.bpm, 0.6, 0.2);
    const notes = active ? activeResult.timeline.notes : track.notes;
    playbackNotes = notes;
    player.loadEvents(notes.map((note) => ({ time: note.startSeconds, duration: note.durationSeconds, midi: note.midi, velocity: note.velocity })), active ? activeResult.timeline.durationSeconds : track.durationSeconds, source.bpm);
    player.setInstrument(sound.value as "piano" | "guitar");
    renderContour(track);
    root.querySelector<HTMLElement>('[data-midi-lab="duration"]')!.textContent = `Original duration: ${clock(track.durationSeconds)} · Active melody: ${clock(activeResult.timeline.durationSeconds)}${active ? " · ACTIVE" : " · ORIGINAL"}`;
    const comparison = compareTrack(track, options.canonicalTimeline, source.bpm);
    root.querySelector<HTMLElement>('[data-midi-lab="diagnostics"]')!.textContent = `Duration Δ ${comparison.durationDifferenceSeconds.toFixed(2)}s · Tempo Δ ${comparison.tempoDifferenceBpm.toFixed(1)} BPM · Density Δ ${comparison.noteDensityDifference.toFixed(2)}/s · Contour ${(comparison.contourSimilarity * 100).toFixed(0)}%`;
    root.querySelector<HTMLElement>('[data-midi-lab="alignment"]')!.textContent = relation.value === "aligned" && !comparison.aligned ? "Reference MIDI is not aligned to canonical score." : "";
  };

  const renderSource = (): void => {
    const source = selectedSource();
    sourceSelect.replaceChildren(...sources.map((entry, index) => new Option(entry.name, String(index), false, index === sourceIndex)));
    trackSelect.replaceChildren(...(source?.tracks ?? []).map((track) => new Option(`Track ${track.trackIndex + 1} · ${track.name}`, String(track.trackIndex))));
    rows.replaceChildren();
    for (const track of source?.tracks ?? []) {
      const row = rows.insertRow();
      [track.sourceName, String(track.trackIndex + 1), track.name, track.instrument, track.channel?.toString() ?? "—", String(track.notes.length), clock(track.durationSeconds), track.pitchMin == null ? "—" : `${noteName(track.pitchMin)}–${noteName(track.pitchMax!)}`, track.texture, `${track.averageGapSeconds.toFixed(2)}s`, track.rank].forEach((value) => { const cell = row.insertCell(); cell.textContent = value; });
      const actions = row.insertCell();
      const solo = document.createElement("button"); solo.type = "button"; solo.textContent = "▶ Solo"; solo.onclick = () => { trackSelect.value = String(track.trackIndex); loadTrack(track, false); void player.play(); };
      const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "■ Stop"; stop.onclick = () => player.stop();
      const active = document.createElement("button"); active.type = "button"; active.textContent = "Active"; active.onclick = () => { trackSelect.value = String(track.trackIndex); loadTrack(track, true); void player.play(); };
      const use = document.createElement("button"); use.type = "button"; use.textContent = "Use as Vocal/Melody"; use.onclick = () => selectManual(track);
      actions.append(solo, stop, active, use);
    }
    const track = source?.tracks[0];
    if (track) loadTrack(track, false);
  };

  const selectManual = (track: InspectedMidiTrack): void => {
    manual = track;
    const selected = chooseSessionMelody(manual, sources.flatMap((source) => source.tracks));
    root.querySelector<HTMLElement>('[data-midi-lab="selection"]')!.textContent = selected ? `${selected.sourceName} · Track ${selected.trackIndex + 1} · ${selected.name}` : "No verified vocal MIDI track selected.";
    root.querySelector<HTMLElement>('[data-midi-lab="selection-kind"]')!.textContent = selected ? "MANUAL SELECTION" : "";
    options.onSessionMelody?.(track);
    const index = sources.findIndex((source) => source.id === track.sourceId);
    if (index >= 0) { sourceIndex = index; renderSource(); trackSelect.value = String(track.trackIndex); loadTrack(track, activeMode); }
  };

  const addSources = (next: InspectedMidiSource[]): void => {
    sources = [...sources, ...next];
    renderSource();
    if (!manual) {
      const suggested = chooseSessionMelody(null, sources.flatMap((source) => source.tracks));
      root.querySelector<HTMLElement>('[data-midi-lab="selection-kind"]')!.textContent = suggested ? `Suggested melody candidate: ${suggested.sourceName} · Track ${suggested.trackIndex + 1}` : "";
    }
  };

  files.onchange = async () => {
    const local = await parseMidiFiles(files.files ?? []);
    addSources(local);
    files.value = "";
  };
  sourceSelect.onchange = () => { sourceIndex = Number(sourceSelect.value); player.stop(); renderSource(); };
  root.querySelector<HTMLButtonElement>('[data-midi-lab="previous"]')!.onclick = () => { sourceIndex = (sourceIndex - 1 + sources.length) % Math.max(1, sources.length); player.stop(); renderSource(); };
  root.querySelector<HTMLButtonElement>('[data-midi-lab="next"]')!.onclick = () => { sourceIndex = (sourceIndex + 1) % Math.max(1, sources.length); player.stop(); renderSource(); };
  trackSelect.onchange = () => { const track = selectedTrack(); if (track) loadTrack(track, false); };
  sound.onchange = () => player.setInstrument(sound.value as "piano" | "guitar");
  relation.onchange = () => { const track = selectedTrack(); if (track) loadTrack(track, activeMode); };
  root.querySelector<HTMLButtonElement>('[data-midi-lab="solo"]')!.onclick = () => { const track = selectedTrack(); if (track) { loadTrack(track, false); void player.play(); } };
  root.querySelector<HTMLButtonElement>('[data-midi-lab="active"]')!.onclick = () => { const track = manual ?? selectedTrack(); if (track) { loadTrack(track, true); void player.play(); } };
  root.querySelector<HTMLButtonElement>('[data-midi-lab="stop"]')!.onclick = () => player.stop();
  root.querySelector<HTMLButtonElement>('[data-midi-lab="use"]')!.onclick = () => { const track = selectedTrack(); if (track) selectManual(track); };

  if (options.canonicalUrl) try {
    const [{ Midi }, response] = await Promise.all([import("@tonejs/midi"), fetch(options.canonicalUrl, { credentials: "omit" })]);
    if (response.ok) addSources([inspectMidiSource("canonical.mid", new Midi(await response.arrayBuffer()) as unknown as MidiLike, "canonical")]);
  } catch { root.querySelector<HTMLElement>('[data-midi-lab="alignment"]')!.textContent = "Canonical MIDI inspection is unavailable."; }

  return () => { player.destroy(); files.value = ""; sources = []; root.replaceChildren(); };
}
