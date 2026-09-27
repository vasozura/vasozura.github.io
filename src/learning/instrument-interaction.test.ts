import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import { activeHarmonyAt, buildHarmonicTimeline } from "./harmony";
import { chooseContinuousGuitarPosition, guitarCandidates, guitarMidiAt, guitarStringLayout } from "./instruments";
import type { ScoreManifest } from "./contracts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const manifest = fixture as ScoreManifest;

describe("Learning instrument interaction", () => {
  it("maps standard guitar strings and frets to exact MIDI pitches", () => {
    expect(guitarStringLayout().map(({ string, openMidi }) => [string, openMidi])).toEqual([[1, 64], [2, 59], [3, 55], [4, 50], [5, 45], [6, 40]]);
    expect(guitarMidiAt(40, 12)).toBe(52);
    expect(guitarMidiAt(64, 20)).toBe(84);
  });

  it("prefers explicit fingering and keeps inferred continuity deterministic", () => {
    expect(guitarCandidates(manifest.timeline.notes[4])[0]).toMatchObject({ confidence: "explicit", string: 1, fret: 8 });
    const note = { ...manifest.timeline.notes[0], id: "deterministic", midi: 69, string: undefined, fret: undefined };
    expect(chooseContinuousGuitarPosition(note, { string: 1, fret: 10 })).toMatchObject({ confidence: "suggestion", string: 2, fret: 10 });
  });

  it("uses the supplied harmonic guitar positions without re-inferring a shape", () => {
    const harmony = buildHarmonicTimeline(manifest.timeline, [{ measureIndex: 0, relativePosition: 0, label: "Am" }])[0];
    expect(activeHarmonyAt([harmony], harmony.startSeconds)?.guitar).toEqual(harmony.guitar);
    expect(harmony.guitar.every(({ string, fret, midi }) => guitarStringLayout().some((entry) => entry.string === string && guitarMidiAt(entry.openMidi, fret) === midi))).toBe(true);
  });

  it("keeps manual audition independent and releases on every pointer termination", async () => {
    const [piano, guitar] = await Promise.all([read("./piano-visualizer.ts"), read("./guitar-visualizer.ts")]);
    for (const source of [piano, guitar]) {
      expect(source).toContain('addEventListener("pointerdown", start)');
      expect(source).toContain('addEventListener("pointerup", stop)');
      expect(source).toContain('addEventListener("pointercancel", stop)');
      expect(source).toContain('addEventListener("pointerleave", stop)');
      expect(source).toContain("this.audition?.noteOff()");
      expect(source).not.toContain("seek(");
    }
    expect(piano).toContain('this.audition?.noteOn(Number(key.dataset.note), "piano")');
    expect(guitar).toContain('this.audition?.noteOn(Number(fret.dataset.midiNote), "guitar")');
  });

  it("updates chord state only in CHORDS mode and clears it on stop", async () => {
    const [mode, guitar] = await Promise.all([read("./learning-mode.ts"), read("./guitar-visualizer.ts")]);
    expect(mode).toContain('activeHarmony = playbackMode.value === "chords" ? harmony : null');
    expect(mode).toContain("clearInstrumentVisuals();");
    expect(mode).toContain("guitar?.setActiveChord(activeHarmony)");
    expect(guitar).toContain('querySelectorAll<HTMLElement>(".chord-active")');
    expect(guitar).toContain("for (const position of harmony.guitar)");
  });

  it("retains stable mobile panel markup and deterministic cell metadata", async () => {
    const [mode, guitar, css] = await Promise.all([read("./learning-mode.ts"), read("./guitar-visualizer.ts"), read("../styles.css")]);
    expect(mode).toContain('class="learning-visualizer-panel"');
    for (const attribute of ["data-string", "data-fret", "data-midi-note"]) expect(guitar).toContain(attribute);
    expect(css).toContain(".learning-fretboard { min-width: 0; overflow-x: auto;");
    expect(css).toContain(".learning-chord-audition { min-width:");
  });
});
