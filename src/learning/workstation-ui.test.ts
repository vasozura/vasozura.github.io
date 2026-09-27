import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Learning Workstation V2 UI contract", () => {
  it("uses obvious persistent segmented state for part, play, sound, timing, voices and mode", async () => {
    const [source, css] = await Promise.all([read("./learning-mode.ts"), read("../styles.css")]);
    for (const selector of ["data-part", "data-play", "data-sound", "data-timing", "data-voices", "data-mode"]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('data-part="melody" aria-pressed="true"');
    expect(source).toContain('data-play="solo" aria-pressed="true"');
    expect(source).toContain('data-timing="continuous" aria-pressed="true"');
    expect(css).toContain('.learning-mode button[aria-pressed="true"]');
    expect(css).toContain("background: var(--acid)");
    expect(source).toContain("<legend>ACTIVE TRACK</legend>");
    expect(source).toContain("selectedInstrument = melodySound.value");
    expect(source).not.toContain('selectedInstrument = selectedPart === "melody"');
  });

  it("shows chord styles only in Chords mode and exposes every requested pattern", async () => {
    const source = await read("./learning-mode.ts");
    expect(source).toContain('data-l="chord-controls" hidden');
    for (const pattern of ["block", "bass-12321", "bass-123-bass-123", "bass-1323", "bass-321", "up", "down", "up-down", "alberti"]) {
      expect(source).toContain(`value="${pattern}"`);
    }
    expect(source).toContain('chordControls.hidden = playbackMode.value !== "chords"');
  });

  it("exposes voices 1-4, semitone/octave, target-key, reset and deterministic mode transforms", async () => {
    const source = await read("./learning-mode.ts");
    expect(source).toContain("[1,2,3,4]");
    for (const offset of ["-12", "12", "-1", "1"]) expect(source).toContain(`data-transpose="${offset}"`);
    expect(source).toContain('data-l="target-key"');
    expect(source).toContain("data-transpose-reset");
    expect(source).toContain('data-mode="major"');
    expect(source).toContain('data-mode="minor"');
  });

  it("keeps exact learning IDs from score click through scheduler and marker", async () => {
    const [mode, score] = await Promise.all([read("./learning-mode.ts"), read("./melody-score.ts")]);
    expect(score).toContain("note.dataset.learningId = entry.id");
    expect(score).toContain('detail: { noteId: entry.id }');
    expect(mode).toContain("learningMelody.notes.find((entry) => entry.id === noteId)");
    expect(mode).toContain("scheduler?.seek(transformed.originalToStudy(note.startSeconds))");
    expect(mode).toContain("melodyScore.setActive(cursorNote?.id ?? null)");
  });

  it("renders a guitar neck with high-E string on top, fret labels once and visual note markers", async () => {
    const [source, css, instruments] = await Promise.all([read("./guitar-visualizer.ts"), read("../styles.css"), read("./instruments.ts")]);
    expect(source).toContain('class="guitar-neck"');
    expect(source.match(/guitarFretLabels\(this\.config\.frets\)/g)).toHaveLength(2);
    expect(source).toContain('aria-label="String ${string}, fret ${fret}"></button>');
    expect(source).not.toContain('>String ${string}, fret ${fret}<');
    expect(css).toContain(".guitar-string button::after");
    expect(css).toContain(".guitar-string button.active::after");
    expect(css).toContain(".guitar-string button.manual-audition::after");
    expect(instruments).toContain(".sort((a, b) => a.string - b.string)");
  });

  it("gives Piano active, upcoming and manual-audition states", async () => {
    const [source, css] = await Promise.all([read("./piano-visualizer.ts"), read("../styles.css")]);
    expect(source).toContain('key.classList.add("manual-audition")');
    expect(source).toContain('note ? "active" : ""');
    expect(source).toContain('upcomingPitches.has(midi) ? "upcoming" : ""');
    expect(css).toContain(".learning-key.manual-audition");
  });

  it("keeps MIDI Lab source, track, melody, gap-fill and audition selections visible", async () => {
    const [source, css] = await Promise.all([read("./midi-lab.ts"), read("../styles.css")]);
    expect(source).toContain("ACTIVE SOURCE");
    expect(source).toContain("dataset.activeSource");
    expect(source).toContain("dataset.activeTrack");
    expect(source).toContain('dataset.midiAction = "melody"');
    expect(source).toContain('dataset.midiAction = "gap-fill"');
    expect(source).toContain('setAttribute("aria-pressed", String(pressed))');
    expect(css).toContain('.midi-lab button[aria-pressed="true"]');
  });

  it("keeps the page contained on mobile while the fretboard scrolls internally", async () => {
    const css = await read("../styles.css");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".learning-workstation-row { display: grid; grid-template-columns: 1fr; }");
    expect(css).toContain(".learning-fretboard { min-width: 0; overflow-x: auto;");
  });
});
