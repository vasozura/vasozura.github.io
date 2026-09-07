import { describe, expect, it } from "vitest";
import fixture from "./fixtures/complex-score.json";
import type { NoteEvent, ScoreManifest } from "./contracts";
import { practicalVoiceCap, selectPlaybackNotes } from "./playback-selection";

const note = (id: string, midi: number, hand: NoteEvent["hand"]): NoteEvent => ({ id, midi, hand, partId: "p", measureIndex: 0, beat: 1, startSeconds: 0, durationSeconds: 1, velocity: 1 });

describe("polyphony playback selection", () => {
  const chord = [note("bass", 48, "left"), note("middle", 64, "right"), note("top", 76, "right")];
  it("keeps full selected polyphony in chords mode", () => expect(selectPlaybackNotes(chord, { mode: "chords", voices: 1, scope: "both" })).toHaveLength(3));
  it("selects highest treble and lowest bass voices deterministically", () => {
    expect(selectPlaybackNotes(chord, { mode: "solo", voices: 1, scope: "treble" }).map((item) => item.id)).toEqual(["top"]);
    expect(selectPlaybackNotes(chord, { mode: "solo", voices: 1, scope: "bass" }).map((item) => item.id)).toEqual(["bass"]);
  });
  it("supports deterministic 1/2/3/4 voice limits and stable Both order", () => {
    const notes = [note("a", 60, "unknown"), note("b", 64, "unknown"), note("c", 67, "unknown"), note("d", 72, "unknown")];
    for (const voices of [1, 2, 3, 4]) expect(selectPlaybackNotes(notes, { mode: "solo", voices, scope: "both" }).map((item) => item.id)).toEqual(notes.slice(0, voices).map((item) => item.id));
  });
  it("prefers explicit staff identity over pitch fallback", () => {
    const lowTreble = { ...note("low-treble", 45, "unknown"), staff: 1 };
    const highBass = { ...note("high-bass", 80, "unknown"), staff: 2 };
    expect(selectPlaybackNotes([lowTreble, highBass], { mode: "solo", voices: 1, scope: "treble" })[0]?.id).toBe("low-treble");
    expect(selectPlaybackNotes([lowTreble, highBass], { mode: "solo", voices: 1, scope: "bass" })[0]?.id).toBe("high-bass");
  });
  it("derives a practical score polyphony cap", () => expect(practicalVoiceCap((fixture as ScoreManifest).timeline)).toBeGreaterThanOrEqual(1));
});
