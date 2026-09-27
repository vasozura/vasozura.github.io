import { SampleInstrumentEngine } from "../audio/sample-instrument";
import { playbackCoordinator } from "../audio/playback-coordinator";
import type { NoteEvent } from "../learning/contracts";
import { GuitarVisualizer } from "../learning/guitar-visualizer";
import { PianoRangeVisualizer } from "../learning/piano-visualizer";
import type { KaraokeArtifactManifest, KaraokeAudioMode, KaraokeChord, KaraokeGuide, KaraokeLyricMode, LearningVocalNote, LyricAlignment } from "./contracts";
import { applyTimingEdits } from "./lyrics-alignment";
import { analyzeSyncLyrics, applyManualSyncPreview, approveManualSync, createManualSyncSession, discardManualSyncDraft, exportManualSyncDraft, finishManualSync, fixManualSyncLine, isManualSyncShortcut, manualSyncProgress, restoreManualSyncDraft, reviewLineTarget, saveManualSyncDraft, sungLines, syncDisplayText, syncLyricLine, undoManualSync } from "./manual-lyric-sync";
import { canonicalSecondsFor, resolveTimeline, type TimelineInput } from "./timeline";
import { createBasicLyricsAlignment, editChordTiming, transposeChordSymbol, transposeForTargetKey } from "./presentation";

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const noteName = (midi: number): string => `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;

function noteEvent(note: LearningVocalNote, transpose = 0): NoteEvent {
  return { id: note.learningId, partId: "vocal-melody", measureIndex: 0, beat: 0, startSeconds: note.originalStartSeconds, durationSeconds: note.originalDurationSeconds, midi: note.midi + transpose, velocity: note.velocity, hand: "unknown" };
}

/** A readable name for the timing source, so the diagnostics read as prose rather than as an
 *  identifier. A source with no entry keeps its own name. */
const ALIGNMENT_LABELS: Partial<Record<LyricAlignment["source"], string>> = {
  "suno-aligned-lyrics": "Suno aligned lyrics",
  "forced-alignment": "Forced alignment",
  "deterministic-review": "Deterministic analysis",
  musicxml: "MusicXML",
  midi: "MIDI",
  manual: "Manual",
};
const alignmentLabel = (source: LyricAlignment["source"]): string => ALIGNMENT_LABELS[source] ?? source;

function lyricMarkup(alignment: LyricAlignment, chords: readonly KaraokeChord[]): string {
  return alignment.lines.map((line) => `<div class="karaoke-line${line.origin === "performance" ? " is-performance" : ""}" data-line-id="${line.id}" data-origin="${line.origin ?? "canonical"}"${line.needsOwnerConfirmation ? ' data-needs-confirmation="true"' : ""} data-start="${line.startSeconds}">${line.words.map((word) => {
    const anchored = chords.filter((item) => item.wordId === word.id);
    const chord = anchored.length ? `<span class="karaoke-chord">${anchored.map((item) => `<span data-chord-id="${item.id}">${escapeHtml(item.symbol)}</span>`).join(" · ")}</span>` : "";
    return `<button type="button" class="karaoke-word" data-word-id="${word.id}" data-start="${word.startSeconds}">${chord}${word.syllables.map((syllable) => `<span data-syllable-id="${syllable.id}" data-start="${syllable.startSeconds}">${escapeHtml(syllable.text)}</span>`).join("")}</button>`;
  }).join(" ")}</div>`).join("");
}

const resolveAsset = (value: string | null | undefined, baseUrl: string): string | null => value ? new URL(value, baseUrl).href : null;

function basicManifest(root: HTMLElement): KaraokeArtifactManifest {
  const lyrics = (root.dataset.lyrics ?? "").replace(/\r\n/g, "\n").trim();
  const duration = Number(root.dataset.durationSeconds) || Math.max(4, lyrics.split(/\n+/).length * 4);
  return {
    version: 1, songId: root.dataset.songId ?? "", slug: root.dataset.slug ?? "", generatedAt: "", sourceAudioSha256: "",
    melodySource: "Not prepared", sourceConfidence: "review", audio: { originalUrl: root.dataset.audioUrl ?? "", instrumentalUrl: null, vocalUrl: null },
    originalNotes: [], continuousNotes: [], alignment: createBasicLyricsAlignment(lyrics, duration), chords: [],
    diagnostics: { noteCount: 0, pitchMin: null, pitchMax: null, medianNoteDurationMs: 0, shortNoteRejectionCount: 0, octaveCorrectionCount: 0, longestSilenceMs: 0, pitchConfidence: 0, monophonyRatio: 1, status: "review" }, exports: {},
  };
}

async function loadManifest(root: HTMLElement): Promise<{ manifest: KaraokeArtifactManifest; baseUrl: string; basic: boolean; warning: string | null }> {
  const slug = root.dataset.slug ?? "";
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const url = root.dataset.manifestUrl || `${base}karaoke/${encodeURIComponent(slug)}/manifest.json`;
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(response.status === 404 ? "Advanced artifacts are not prepared." : `Karaoke artifacts unavailable (${response.status}).`);
    const manifest = await response.json() as KaraokeArtifactManifest;
    const lyrics = (root.dataset.lyrics ?? "").replace(/\r\n/g, "\n").trim();
    if (manifest.version !== 1 || manifest.slug !== slug || manifest.alignment.authoritativeText !== lyrics) throw new Error("Prepared artifacts do not match the authoritative song lyrics.");
    return { manifest, baseUrl: new URL(".", new URL(url, root.ownerDocument.baseURI)).href, basic: false, warning: null };
  } catch (error) {
    return { manifest: basicManifest(root), baseUrl: root.ownerDocument.baseURI, basic: true, warning: error instanceof Error ? error.message : "Advanced artifacts are not prepared." };
  }
}

export async function mountKaraokeMode(root: HTMLElement): Promise<() => void> {
  const loaded = await loadManifest(root);
  const manifest = loaded.manifest;
  const originalUrl = root.dataset.audioUrl ?? "";
  const instrumentalUrl = resolveAsset(manifest.audio.instrumentalUrl, loaded.baseUrl);
  const hasInstrumental = Boolean(instrumentalUrl);
  // A prepared manifest states which guides it supports; older ones only imply it by having notes.
  const guideInstruments: ReadonlyArray<"piano" | "guitar"> = manifest.guide?.instruments?.length
    ? manifest.guide.instruments
    : manifest.originalNotes.length > 0 ? ["piano", "guitar"] : [];
  const hasGuide = guideInstruments.length > 0 && manifest.originalNotes.length > 0;
  const exportLinks = Object.entries(manifest.exports).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const badge = (label: string, ready: boolean, detail = ""): string =>
    `<span class="karaoke-badge${ready ? " is-ready" : ""}"${detail ? ` title="${escapeHtml(detail)}"` : ""}>${escapeHtml(label)} <b aria-hidden="true">${ready ? "✓" : "—"}</b><span class="visually-hidden">${ready ? "available" : "not prepared"}</span></span>`;
  const group = (legend: string, body: string, extra = ""): string =>
    `<div class="karaoke-group${extra ? ` ${extra}` : ""}" role="group" aria-label="${escapeHtml(legend)}"><span class="karaoke-group-label">${escapeHtml(legend)}</span><div class="karaoke-segmented">${body}</div></div>`;

  // The workstation: a compact header, one control bar, the lyric stage, a one-line status strip,
  // the guide, and everything an engineer needs folded away behind Advanced.
  root.innerHTML = `<div class="karaoke-heading"><h2>VOCAL / KARAOKE</h2>
      <div class="karaoke-availability karaoke-badges" aria-live="polite">${[
        badge("Lyrics", true, `${manifest.alignment.lines.length} lines`),
        badge("Instrumental", hasInstrumental, hasInstrumental ? "Prepared" : "Not prepared"),
        badge("Guide", hasGuide, hasGuide ? guideInstruments.join(" / ") : "Not prepared"),
        badge("Karaoke", true, "Karaoke: AVAILABLE"),
      ].join("")}</div></div>
    <div class="karaoke-controls" role="group" aria-label="Karaoke controls">
      ${group("Audio", `<button type="button" data-audio-mode="original" aria-pressed="true">Original</button><button type="button" data-audio-mode="instrumental" aria-pressed="false" ${hasInstrumental ? "" : "disabled title=\"Not prepared\""}>Instrumental</button><button type="button" data-audio-mode="guide" aria-pressed="false" ${hasInstrumental && hasGuide ? "" : "disabled title=\"Not prepared\""}>+ Guide</button>`)}
      ${group("Lyrics", (["line", "word", "syllable"] as const).map((mode) => `<button type="button" data-lyric-mode="${mode}" aria-pressed="${mode === "word"}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`).join(""))}
      ${group("Guide", (["off", "piano", "guitar"] as const).map((value) => { const enabled = value === "off" || (hasGuide && guideInstruments.includes(value)); return `<button type="button" data-guide="${value}" aria-pressed="${value === (hasGuide ? guideInstruments[0] : "off")}" ${enabled ? "" : "disabled title=\"Not prepared\""}>${value[0].toUpperCase()}${value.slice(1)}</button>`; }).join(""))}
      ${group("Chords", `<button type="button" data-chords aria-pressed="true">On</button><button type="button" data-chords-off aria-pressed="false">Off</button>`)}
      <div class="karaoke-group karaoke-sliders">
        <label>Guide vol <input data-guide-volume type="range" min="0" max="100" value="32"></label>
        <label>Tempo <input data-tempo type="range" min="50" max="150" value="100"><output>100%</output></label>
        <label>Transpose <input data-transpose type="number" min="-12" max="12" value="0"><output>0 st</output></label>
        <label>Key <select data-target-key><option value="">Original</option>${["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"].map((key) => `<option value="${key}">${key}</option>`).join("")}</select></label>
      </div>
    </div>
    <audio class="karaoke-transport" data-karaoke-audio controls preload="metadata" src="${escapeHtml(originalUrl)}"></audio>
    <section class="karaoke-manual-sync" aria-label="Manual lyric synchronization">
      <div data-sync-start-panel><button type="button" data-start-sync>Start synchronization</button><button type="button" data-resume-sync hidden>Resume saved synchronization</button><button type="button" data-discard-sync hidden>Discard local draft</button></div>
      <div data-sync-capture-panel hidden><p class="karaoke-sync-progress" data-sync-progress>Synced 0 of 0 lines</p><p class="karaoke-sync-prompt">Press SYNC when this line begins:</p><strong class="karaoke-sync-line" data-sync-current>—</strong><button class="karaoke-sync-button" type="button" data-sync-line-button>SYNC <kbd>S</kbd></button><div class="karaoke-editor-actions"><button type="button" data-undo-sync disabled>Undo last sync</button><button type="button" data-finish-sync>Finish and review</button></div></div>
      <div data-sync-review-panel hidden><p class="karaoke-sync-progress"><strong>Review mode</strong></p><strong class="karaoke-sync-line" data-review-current>—</strong><div class="karaoke-editor-actions"><button type="button" data-review-previous>Previous line</button><button type="button" data-review-replay>Replay current line</button><button type="button" data-review-next>Next line</button><button type="button" data-approve-sync>Timing is correct</button><button type="button" data-fix-sync>Fix this line</button></div></div>
      <p data-sync-status aria-live="polite">Nothing has been published.</p>
      <details class="karaoke-skipped-directions"><summary data-skipped-summary>Skipped production directions: 0</summary><div data-skipped-details></div></details>
    </section>
    <div class="karaoke-viewer" data-lyric-display="word"><p class="karaoke-instrumental-cue" aria-hidden="true">Instrumental</p><div class="karaoke-lines">${lyricMarkup(applyManualSyncPreview(manifest.alignment, []), manifest.chords)}</div></div>
    <p class="karaoke-note-status"><span>Note <strong data-current-note>—</strong></span><span>Lyric <strong data-current-lyric>—</strong></span><span>Next <strong data-next>—</strong></span></p>
    <div class="karaoke-visualizer" data-karaoke-visualizer></div>
    <details class="karaoke-advanced"><summary>Advanced</summary>
      <div class="karaoke-advanced-body">
        <section class="karaoke-diagnostics"><h3>Source and diagnostics</h3>
          <p class="karaoke-source">Melody source: <strong>${escapeHtml(manifest.melody?.label ?? manifest.melodySource)}</strong> · ${escapeHtml(manifest.melody?.confidence ?? manifest.sourceConfidence)}${manifest.melody ? `<span class="karaoke-source-reason"> ${escapeHtml(manifest.melody.reason)}</span>` : ""}</p>
          ${manifest.provenance ? `<p class="karaoke-source">Prepared by ${escapeHtml(manifest.provenance.tool)} · ${escapeHtml(manifest.provenance.analysis)}${manifest.provenance.stemSeparation ? "" : " · no stem separation"}</p>` : ""}
          ${loaded.warning ? `<p class="karaoke-source">${escapeHtml(loaded.warning)}</p>` : ""}
          <dl><div><dt>Notes</dt><dd>${manifest.diagnostics.noteCount}</dd></div><div><dt>Pitch range</dt><dd>${manifest.diagnostics.pitchMin ?? "—"}–${manifest.diagnostics.pitchMax ?? "—"}</dd></div><div><dt>Longest silence</dt><dd>${manifest.diagnostics.longestSilenceMs} ms</dd></div><div><dt>Pitch confidence</dt><dd>${Math.round(manifest.diagnostics.pitchConfidence * 100)}%</dd></div><div><dt>Alignment</dt><dd>${alignmentLabel(manifest.alignment.source)}</dd></div><div><dt>Status</dt><dd>${manifest.diagnostics.status === "review" ? "Review required" : "Verified"}</dd></div></dl>
        </section>
        <section class="karaoke-timing-editor"><h3>Timing editor</h3><p>Technical timing controls.</p><label>Entity <select data-edit-entity>${manifest.alignment.lines.flatMap((line) => [`<option value="line:${line.id}">Line · ${escapeHtml(line.text)}</option>`, ...line.words.flatMap((word) => [`<option value="word:${word.id}">Word · ${escapeHtml(word.text)}</option>`, ...word.syllables.map((syllable) => `<option value="syllable:${syllable.id}">Syllable · ${escapeHtml(syllable.text)}</option>`)])]).join("")}${manifest.chords.map((chord) => `<option value="chord:${chord.id}">Chord · ${escapeHtml(chord.symbol)}</option>`).join("")}</select></label><label>Start <input data-edit-start type="number" min="0" step="0.01"></label><label>End <input data-edit-end type="number" min="0" step="0.01"></label><label>Mapped note IDs <input data-edit-notes type="text" placeholder="note-id, note-id"></label><div class="karaoke-editor-actions"><button type="button" data-preview-word>Preview selection</button><button type="button" data-save-timing>Save timing in this session</button><button type="button" data-export-timing>Download timing JSON</button><button type="button" data-export-sync-backup>Download manual-sync backup</button></div><p data-edit-status></p></section>
        ${exportLinks.length ? `<section class="karaoke-exports"><h3>Exports</h3><div class="karaoke-export-links">${exportLinks.map(([key, url]) => `<a href="${escapeHtml(resolveAsset(url, loaded.baseUrl) ?? "#")}" download>${escapeHtml(key)}</a>`).join("")}</div></section>` : ""}
      </div>
    </details>`;

  const audio = root.querySelector<HTMLAudioElement>("[data-karaoke-audio]")!;
  const engine = new SampleInstrumentEngine();
  const visualRoot = root.querySelector<HTMLElement>("[data-karaoke-visualizer]")!;
  const viewer = root.querySelector<HTMLElement>(".karaoke-viewer")!;
  let visualizer: PianoRangeVisualizer | GuitarVisualizer | null = null;
  let lyricMode: KaraokeLyricMode = "word";
  let audioMode: KaraokeAudioMode = "original";
  let guide: KaraokeGuide = hasGuide ? guideInstruments[0] : "off";
  let lastNoteId = "";
  let raf = 0;
  let timingAlignment = structuredClone(manifest.alignment);
  let manualSync = (() => { try { return restoreManualSyncDraft(window.localStorage, manifest); } catch { return null; } })() ?? createManualSyncSession(manifest);
  let sessionAlignment = applyManualSyncPreview(timingAlignment, manualSync.draft.overrides);
  let sessionChords = structuredClone(manifest.chords);
  let syncMode: "idle" | "capture" | "review" | "approved" = manualSync.draft.status === "review" ? "review" : manualSync.draft.status === "approved" ? "approved" : "idle";
  let selectedSyncLineId = manualSync.draft.overrides[0]?.lineId ?? sungLines(timingAlignment)[0]?.id ?? "";
  let fixingLineId: string | null = null;
  const transposeInput = root.querySelector<HTMLInputElement>("[data-transpose]")!;
  const transpose = (): number => Math.max(-12, Math.min(12, Number(transposeInput.value) || 0));
  const playback = { canPlay: () => Boolean(audio.src), play: () => audio.play(), pause: () => audio.pause(), stop: () => { audio.pause(); audio.currentTime = 0; lastNoteId = ""; engine.releaseAll(); paint(); }, isPlaying: () => !audio.paused };
  const unregisterPlayback = playbackCoordinator.register("karaoke", playback);

  const rebuildVisualizer = (): void => {
    visualizer?.destroy(); visualizer = null;
    if (guide === "off" || !hasGuide) { visualRoot.innerHTML = "<p>Guide melody is off.</p>"; return; }
    const audition = { noteOn: (midi: number) => { void engine.enable([midi]).then(() => engine.play({ midi, velocity: .7, durationSeconds: .5 })); }, noteOff: () => engine.releaseAll() };
    visualizer = guide === "guitar" ? new GuitarVisualizer(visualRoot, undefined, audition) : new PianoRangeVisualizer(visualRoot, manifest.originalNotes.map((note) => noteEvent(note, transpose())), true, audition);
    engine.setInstrument(guide); visualizer.mount();
  };

  const timelineInput = (): TimelineInput => ({ alignment: sessionAlignment, originalNotes: manifest.originalNotes, continuousNotes: manifest.continuousNotes, chords: sessionChords });

  const paint = (): void => {
    const time = audio.currentTime;
    // One resolution per frame drives the lyric highlight, the marker and the visualizer together,
    // so no view can disagree with another about where the playhead is.
    const position = resolveTimeline(timelineInput(), time);
    const { note, nextNote, line, word, syllable } = position;
    // Three states, and the middle one is real: a line is being sung, nobody is singing, or the next
    // line has not started yet. An upcoming line is shown subdued and is never marked active, so an
    // instrumental introduction or a rest between verses highlights nothing at all.
    const activeId = line?.id ?? null;
    const previousId = position.previousLine?.id ?? null;
    const upcomingId = position.upcomingLine?.id ?? null;
    root.querySelectorAll<HTMLElement>("[data-line-id]").forEach((element) => {
      const id = element.dataset.lineId;
      element.classList.toggle("is-previous", id === previousId && id !== activeId);
      element.classList.toggle("is-active", id === activeId);
      element.classList.toggle("is-next", id === upcomingId && id !== activeId);
    });
    viewer.classList.toggle("is-instrumental", position.isInstrumental);
    root.querySelectorAll<HTMLElement>("[data-word-id]").forEach((element) => element.classList.toggle("is-active", lyricMode === "word" && element.dataset.wordId === word?.id));
    root.querySelectorAll<HTMLElement>("[data-syllable-id]").forEach((element) => element.classList.toggle("is-active", lyricMode === "syllable" && element.dataset.syllableId === syllable?.id));
    viewer.dataset.lyricDisplay = lyricMode;
    root.querySelectorAll<HTMLElement>("[data-chord-id]").forEach((element) => { const chord = sessionChords.find((item) => item.id === element.dataset.chordId); if (chord) element.textContent = transposeChordSymbol(chord.symbol, transpose()); });
    root.querySelector<HTMLElement>("[data-current-note]")!.textContent = note ? noteName(note.midi + transpose()) : "—";
    root.querySelector<HTMLElement>("[data-current-lyric]")!.textContent = position.isInstrumental ? "Instrumental" : lyricMode === "syllable" ? syllable?.text ?? word?.text ?? line?.text ?? "—" : word?.text ?? line?.text ?? "—";
    root.querySelector<HTMLElement>("[data-next]")!.textContent = nextNote ? `${noteName(nextNote.midi + transpose())} · ${sessionAlignment.lines.flatMap((item) => item.words).find((item) => item.id === nextNote.wordId)?.text ?? ""}` : "—";
    visualizer?.render(note ? [noteEvent(note, transpose())] : [], nextNote ? [noteEvent(nextNote, transpose())] : []);
    if (audioMode === "guide" && guide !== "off" && note && note.learningId !== lastNoteId) { lastNoteId = note.learningId; const volume = Number(root.querySelector<HTMLInputElement>("[data-guide-volume]")!.value) / 100; engine.play({ midi: note.midi + transpose(), velocity: note.velocity * volume, durationSeconds: note.originalDurationSeconds / audio.playbackRate }); }
    if (!audio.paused) raf = requestAnimationFrame(paint);
  };

  rebuildVisualizer(); paint();
  audio.addEventListener("play", () => { playbackCoordinator.activate("karaoke"); void (guide !== "off" && hasGuide ? engine.enable(manifest.originalNotes.map((note) => note.midi + transpose())) : Promise.resolve()); cancelAnimationFrame(raf); paint(); });
  audio.addEventListener("pause", () => { cancelAnimationFrame(raf); engine.releaseAll(); });
  audio.addEventListener("seeked", () => { lastNoteId = ""; engine.releaseAll(); paint(); });
  root.querySelectorAll<HTMLButtonElement>("[data-audio-mode]").forEach((button) => button.addEventListener("click", () => { audioMode = button.dataset.audioMode as KaraokeAudioMode; root.querySelectorAll<HTMLButtonElement>("[data-audio-mode]").forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button))); const position = audio.currentTime; const playing = !audio.paused; audio.pause(); audio.src = audioMode === "original" ? originalUrl : instrumentalUrl ?? originalUrl; audio.currentTime = position; lastNoteId = ""; if (playing) void audio.play(); }));
  root.querySelectorAll<HTMLButtonElement>("[data-lyric-mode]").forEach((button) => button.addEventListener("click", () => { lyricMode = button.dataset.lyricMode as KaraokeLyricMode; root.querySelectorAll<HTMLButtonElement>("[data-lyric-mode]").forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button))); paint(); }));
  const setChords = (enabled: boolean): void => { viewer.classList.toggle("chords-off", !enabled); root.querySelector<HTMLButtonElement>("[data-chords]")!.setAttribute("aria-pressed", String(enabled)); root.querySelector<HTMLButtonElement>("[data-chords-off]")!.setAttribute("aria-pressed", String(!enabled)); };
  root.querySelector<HTMLButtonElement>("[data-chords]")!.addEventListener("click", () => setChords(true)); root.querySelector<HTMLButtonElement>("[data-chords-off]")!.addEventListener("click", () => setChords(false));
  root.querySelectorAll<HTMLButtonElement>("[data-guide]").forEach((button) => button.addEventListener("click", () => { guide = button.dataset.guide as KaraokeGuide; root.querySelectorAll<HTMLButtonElement>("[data-guide]").forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button))); rebuildVisualizer(); lastNoteId = ""; paint(); }));
  root.querySelector<HTMLInputElement>("[data-tempo]")!.addEventListener("input", (event) => { const input = event.currentTarget as HTMLInputElement; audio.playbackRate = Number(input.value) / 100; input.nextElementSibling!.textContent = `${input.value}%`; lastNoteId = ""; });
  transposeInput.addEventListener("input", () => { transposeInput.value = String(transpose()); transposeInput.nextElementSibling!.textContent = `${transpose()} st`; rebuildVisualizer(); lastNoteId = ""; paint(); });
  root.querySelector<HTMLSelectElement>("[data-target-key]")!.addEventListener("change", (event) => { const target = (event.currentTarget as HTMLSelectElement).value; const value = target ? transposeForTargetKey(root.dataset.musicalKey, target) : 0; if (value === null) { (event.currentTarget as HTMLSelectElement).value = ""; return; } transposeInput.value = String(value); transposeInput.dispatchEvent(new Event("input")); });
  // Seeking from a lyric keeps the transport state it found: playing stays playing, paused stays
  // paused. The id is resolved against the session alignment, so an edited timing seeks correctly.
  viewer.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-start]") : null;
    if (!target || !viewer.contains(target)) return;
    event.preventDefault();
    if (syncMode === "capture" && target.dataset.lineId) {
      selectedSyncLineId = target.dataset.lineId;
      performSync();
      return;
    }
    const anchor = target.dataset.syllableId ? { type: "syllable" as const, id: target.dataset.syllableId } : target.dataset.wordId ? { type: "word" as const, id: target.dataset.wordId } : target.dataset.lineId ? { type: "line" as const, id: target.dataset.lineId } : null;
    const seconds = anchor ? canonicalSecondsFor(timelineInput(), anchor) : null;
    audio.currentTime = seconds ?? Number(target.dataset.start);
    lastNoteId = "";
    engine.releaseAll();
    paint();
  });

  const entity = root.querySelector<HTMLSelectElement>("[data-edit-entity]")!;
  const editStart = root.querySelector<HTMLInputElement>("[data-edit-start]")!;
  const editEnd = root.querySelector<HTMLInputElement>("[data-edit-end]")!;
  const editNotes = root.querySelector<HTMLInputElement>("[data-edit-notes]")!;
  const findEntity = (): { type: "line" | "word" | "syllable" | "chord"; id: string; startSeconds: number; endSeconds: number; noteIds?: string[] } | null => {
    const separator = entity.value.indexOf(":"); const type = entity.value.slice(0, separator) as "line" | "word" | "syllable" | "chord"; const id = entity.value.slice(separator + 1);
    if (type === "chord") { const chord = sessionChords.find((item) => item.id === id); return chord ? { type, id, startSeconds: chord.startSeconds, endSeconds: chord.endSeconds } : null; }
    for (const line of sessionAlignment.lines) { if (type === "line" && line.id === id) return { type, id, startSeconds: line.startSeconds, endSeconds: line.endSeconds }; for (const word of line.words) { if (type === "word" && word.id === id) return { type, id, startSeconds: word.startSeconds, endSeconds: word.endSeconds }; const syllable = word.syllables.find((item) => type === "syllable" && item.id === id); if (syllable) return { type, id, startSeconds: syllable.startSeconds, endSeconds: syllable.endSeconds, noteIds: syllable.noteIds }; } }
    return null;
  };
  const loadEditor = (): void => { const item = findEntity(); if (!item) return; editStart.value = item.startSeconds.toFixed(2); editEnd.value = item.endSeconds.toFixed(2); editNotes.value = item.noteIds?.join(", ") ?? ""; editNotes.disabled = item.type !== "syllable"; };
  entity.addEventListener("change", loadEditor); loadEditor();
  root.querySelector<HTMLButtonElement>("[data-preview-word]")!.addEventListener("click", () => { audio.currentTime = Number(editStart.value); void audio.play(); });
  root.querySelector<HTMLButtonElement>("[data-save-timing]")!.addEventListener("click", () => { const item = findEntity(); const start = Number(editStart.value); const end = Number(editEnd.value); const status = root.querySelector<HTMLElement>("[data-edit-status]")!; if (!item || !(start >= 0 && end > start)) { status.textContent = "End must be after start."; return; } if (item.type === "chord") sessionChords = editChordTiming(sessionChords, item.id, start, end); else { timingAlignment = applyTimingEdits(timingAlignment, [{ type: item.type, id: item.id, startSeconds: start, endSeconds: end }]); if (item.type === "syllable") for (const line of timingAlignment.lines) for (const word of line.words) { const syllable = word.syllables.find((entry) => entry.id === item.id); if (syllable) syllable.noteIds = editNotes.value.split(",").map((value) => value.trim()).filter(Boolean); } sessionAlignment = applyManualSyncPreview(timingAlignment, manualSync.draft.overrides); } status.textContent = "Saved in this session. Download timing JSON to persist the review file."; paint(); });
  root.querySelector<HTMLButtonElement>("[data-export-timing]")!.addEventListener("click", () => { const blob = new Blob([`${JSON.stringify({ alignment: sessionAlignment, chords: sessionChords }, null, 2)}\n`], { type: "application/json" }); const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `${manifest.slug}-karaoke-timing.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 0); });

  const syncStatus = root.querySelector<HTMLElement>("[data-sync-status]")!;
  const undoSyncButton = root.querySelector<HTMLButtonElement>("[data-undo-sync]")!;
  const startPanel = root.querySelector<HTMLElement>("[data-sync-start-panel]")!;
  const capturePanel = root.querySelector<HTMLElement>("[data-sync-capture-panel]")!;
  const reviewPanel = root.querySelector<HTMLElement>("[data-sync-review-panel]")!;
  const saveLocalDraft = (): void => { try { saveManualSyncDraft(window.localStorage, manifest, manualSync); } catch { syncStatus.textContent = "The browser could not save this local draft."; } };
  const downloadBackup = (serialized = exportManualSyncDraft(manualSync)): void => { const blob = new Blob([serialized], { type: "application/json" }); const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `${manifest.slug}-manual-lyric-sync.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 0); };
  const firstUnsyncedLineId = (): string => { const synced = new Set(manualSync.draft.overrides.map((item) => item.lineId)); return sungLines(timingAlignment).find((line) => !synced.has(line.id))?.id ?? manualSync.draft.overrides.at(-1)?.lineId ?? sungLines(timingAlignment)[0]?.id ?? ""; };
  const updateSyncEditor = (): void => {
    const progress = manualSyncProgress(manualSync, timingAlignment);
    const displayText = syncDisplayText(timingAlignment, selectedSyncLineId) || "—";
    root.querySelector<HTMLElement>("[data-sync-progress]")!.textContent = `Synced ${progress.synced} of ${progress.total} sung lines`;
    root.querySelector<HTMLElement>("[data-sync-current]")!.textContent = displayText;
    root.querySelector<HTMLElement>("[data-review-current]")!.textContent = displayText;
    startPanel.hidden = syncMode !== "idle";
    capturePanel.hidden = syncMode !== "capture";
    reviewPanel.hidden = syncMode !== "review" && syncMode !== "approved";
    const hasSavedDraft = manualSync.draft.overrides.length > 0;
    root.querySelector<HTMLButtonElement>("[data-start-sync]")!.hidden = hasSavedDraft;
    root.querySelector<HTMLButtonElement>("[data-resume-sync]")!.hidden = !hasSavedDraft;
    root.querySelector<HTMLButtonElement>("[data-discard-sync]")!.hidden = !hasSavedDraft;
    undoSyncButton.disabled = manualSync.undo.length === 0;
  };
  const refreshManualPreview = (): void => {
    sessionAlignment = applyManualSyncPreview(timingAlignment, manualSync.draft.overrides);
    const manualIds = new Set(manualSync.draft.overrides.map((override) => override.lineId));
    root.querySelectorAll<HTMLElement>("[data-line-id]").forEach((element) => element.classList.toggle("is-manually-synced", manualIds.has(element.dataset.lineId ?? "")));
    updateSyncEditor(); paint();
  };
  const performSync = (): void => {
    if (syncMode !== "capture") return;
    const capturedLineId = selectedSyncLineId;
    const result = syncLyricLine(manualSync, timingAlignment, capturedLineId, audio.currentTime);
    if (!result.ok) { syncStatus.textContent = result.message; return; }
    manualSync = result.session;
    selectedSyncLineId = result.selectedLineId;
    saveLocalDraft();
    if (fixingLineId === capturedLineId) {
      fixingLineId = null;
      const reviewed = finishManualSync(manualSync, manifest);
      if (!reviewed.ok) { syncStatus.textContent = reviewed.message; refreshManualPreview(); return; }
      manualSync = reviewed.session; selectedSyncLineId = capturedLineId; syncMode = "review"; saveLocalDraft();
      syncStatus.textContent = "Updated this line. Review mode restored.";
    } else {
      const progress = manualSyncProgress(manualSync, timingAlignment);
      syncStatus.textContent = progress.synced === progress.total ? "All lines are synchronized. Select Finish and review." : "Saved locally. Listen for the displayed line.";
    }
    refreshManualPreview();
  };
  const beginCapture = (resume: boolean): void => { manualSync = resume ? manualSync : createManualSyncSession(manifest); selectedSyncLineId = resume ? firstUnsyncedLineId() : sungLines(timingAlignment)[0]?.id ?? ""; syncMode = "capture"; audio.currentTime = 0; syncStatus.textContent = resume ? "Saved synchronization resumed." : "Playback started. Press SYNC when the displayed line begins."; updateSyncEditor(); void audio.play(); };
  root.querySelector<HTMLButtonElement>("[data-start-sync]")!.addEventListener("click", () => beginCapture(false));
  root.querySelector<HTMLButtonElement>("[data-resume-sync]")!.addEventListener("click", () => beginCapture(true));
  root.querySelector<HTMLButtonElement>("[data-discard-sync]")!.addEventListener("click", () => { if (!window.confirm("Discard the saved local synchronization draft?")) return; try { discardManualSyncDraft(window.localStorage, manifest); } catch { /* No persisted draft remains accessible. */ } manualSync = createManualSyncSession(manifest); sessionAlignment = structuredClone(timingAlignment); syncMode = "idle"; selectedSyncLineId = sungLines(timingAlignment)[0]?.id ?? ""; syncStatus.textContent = "Local draft discarded. Nothing has been published."; refreshManualPreview(); });
  root.querySelector<HTMLButtonElement>("[data-sync-line-button]")!.addEventListener("click", performSync);
  undoSyncButton.addEventListener("click", () => { manualSync = undoManualSync(manualSync); selectedSyncLineId = firstUnsyncedLineId(); saveLocalDraft(); syncStatus.textContent = "Last synchronization undone."; refreshManualPreview(); });
  root.querySelector<HTMLButtonElement>("[data-finish-sync]")!.addEventListener("click", () => { const result = finishManualSync(manualSync, manifest); if (!result.ok) { syncStatus.textContent = result.message; return; } manualSync = result.session; selectedSyncLineId = result.firstLineId; syncMode = "review"; saveLocalDraft(); downloadBackup(result.serialized); audio.currentTime = result.firstStartSeconds; syncStatus.textContent = "Review mode. Check each line, then select Timing is correct."; refreshManualPreview(); void audio.play(); });
  const navigateReview = (direction: "previous" | "current" | "next", play: boolean): void => { const target = reviewLineTarget(manualSync, timingAlignment, selectedSyncLineId, direction); if (!target) return; selectedSyncLineId = target.lineId; audio.currentTime = target.startSeconds; updateSyncEditor(); paint(); if (play) void audio.play(); };
  root.querySelector<HTMLButtonElement>("[data-review-previous]")!.addEventListener("click", () => navigateReview("previous", false));
  root.querySelector<HTMLButtonElement>("[data-review-replay]")!.addEventListener("click", () => navigateReview("current", true));
  root.querySelector<HTMLButtonElement>("[data-review-next]")!.addEventListener("click", () => navigateReview("next", false));
  root.querySelector<HTMLButtonElement>("[data-fix-sync]")!.addEventListener("click", () => { const target = reviewLineTarget(manualSync, timingAlignment, selectedSyncLineId, "current"); if (!target) return; manualSync = fixManualSyncLine(manualSync, selectedSyncLineId); fixingLineId = selectedSyncLineId; syncMode = "capture"; saveLocalDraft(); audio.currentTime = Math.max(0, target.startSeconds - 2); syncStatus.textContent = "Listen for this line and press SYNC once."; updateSyncEditor(); void audio.play(); });
  root.querySelector<HTMLButtonElement>("[data-approve-sync]")!.addEventListener("click", () => { manualSync = approveManualSync(manualSync); syncMode = "approved"; saveLocalDraft(); syncStatus.textContent = "Manual synchronization saved and verified locally. Nothing has been published."; updateSyncEditor(); });
  root.querySelector<HTMLButtonElement>("[data-export-sync-backup]")!.addEventListener("click", () => downloadBackup());
  const onSyncShortcut = (event: KeyboardEvent): void => { if (syncMode !== "capture" || !isManualSyncShortcut(event)) return; event.preventDefault(); performSync(); };
  root.ownerDocument.addEventListener("keydown", onSyncShortcut);
  const syncAnalysis = analyzeSyncLyrics(timingAlignment);
  const directionLines = syncAnalysis.filter((item) => item.productionDirections.length > 0);
  const malformedLines = syncAnalysis.filter((item) => item.status === "needs-review");
  root.querySelector<HTMLElement>("[data-skipped-summary]")!.textContent = `Skipped production directions: ${directionLines.reduce((sum, item) => sum + item.productionDirections.length, 0)}`;
  root.querySelector<HTMLElement>("[data-skipped-details]")!.innerHTML = `${directionLines.length ? `<p>${directionLines.map((item) => `Line ${item.sourceLineNumber}: ${escapeHtml(item.productionDirections.join(" "))}`).join("<br>")}</p>` : ""}${malformedLines.length ? `<p><strong>Needs review:</strong> ${malformedLines.map((item) => `line ${item.sourceLineNumber}`).join(", ")}</p>` : ""}`;
  if (manualSync.draft.status === "review" || manualSync.draft.status === "approved") selectedSyncLineId = manualSync.draft.overrides[0]?.lineId ?? selectedSyncLineId;
  if (manualSync.draft.status === "approved") syncStatus.textContent = "Manual synchronization saved and verified locally. Nothing has been published.";
  updateSyncEditor();

  return () => { cancelAnimationFrame(raf); audio.pause(); engine.destroy(); visualizer?.destroy(); unregisterPlayback(); root.ownerDocument.removeEventListener("keydown", onSyncShortcut); };
}
