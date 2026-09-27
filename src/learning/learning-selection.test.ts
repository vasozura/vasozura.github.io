import { describe, expect, it } from "vitest";
import type { NoteEvent } from "./contracts";
import { learningSelectionStorageKey, rememberLearningSelection, resolveStaffScope, restoreLearningSelection, staffScopeSupport, visualizerAvailability, type LearningSelectionStorage } from "./learning-selection";
import type { ActiveTrackOption, VoiceLane } from "./voice-lanes";

class MemoryStorage implements LearningSelectionStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const note = (id: string, midi: number, staff?: number): NoteEvent => ({ id, midi, staff, hand: "unknown", partId: "p", measureIndex: 0, beat: 1, startSeconds: 0, durationSeconds: 1, velocity: 1 });
const option = (notes: NoteEvent[]): ActiveTrackOption => ({ id: "piano", label: "PIANO", arrangementPart: "piano", lane: { id: "p", label: "Piano", partId: "p", partName: "Piano", staff: null, voice: "1", inferred: false, notes } as VoiceLane });

describe("Learning selection state", () => {
  it("remembers track and staff scope separately per song", () => {
    const storage = new MemoryStorage();
    rememberLearningSelection(storage, "song-a", { activeTrackId: "guitar", staffScope: "bass" });
    rememberLearningSelection(storage, "song-b", { activeTrackId: "melody", staffScope: "treble" });
    expect(restoreLearningSelection(storage, "song-a")).toEqual({ activeTrackId: "guitar", staffScope: "bass" });
    expect(restoreLearningSelection(storage, "song-b")).toEqual({ activeTrackId: "melody", staffScope: "treble" });
    expect(learningSelectionStorageKey("song/a")).toContain("song%2Fa");
  });

  it("rejects malformed persistence and resolves unsupported scope deterministically", () => {
    const storage = new MemoryStorage(); storage.setItem(learningSelectionStorageKey("s"), "{bad");
    expect(restoreLearningSelection(storage, "s")).toBeNull();
    expect(resolveStaffScope("bass", { treble: true, bass: false, both: true, inferred: false })).toBe("both");
  });

  it("enables only evidenced staff scopes and marks pitch fallback as inferred", () => {
    expect(staffScopeSupport(option([note("t", 45, 1), note("b", 80, 2)]))).toEqual({ treble: true, bass: true, both: true, inferred: false });
    expect(staffScopeSupport(option([note("high", 72)]))).toEqual({ treble: true, bass: false, both: true, inferred: true });
  });

  it("reports incompatible visualizers without mutating the requested instrument", () => {
    const high = option([note("high", 96, 1)]);
    expect(visualizerAvailability("guitar", high, "treble", false)).toMatchObject({ available: false });
    expect(visualizerAvailability("piano", high, "treble", false)).toEqual({ available: true, reason: "" });
    expect(visualizerAvailability("accordion", high, "treble", false).reason).toContain("verified mapping");
  });
});
