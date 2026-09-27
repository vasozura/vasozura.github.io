import { describe, expect, it } from "vitest";
import type { KaraokeArtifactManifest, LyricAlignment, LyricLine } from "./contracts";
import { analyzeSyncLyricLine, analyzeSyncLyrics, applyManualSyncPreview, approveManualSync, createManualSyncSession, finishManualSync, fixManualSyncLine, importManualSyncDraft, isManualSyncShortcut, manualSyncProgress, manualSyncStorageKey, nextSungLineId, restoreManualSyncDraft, reviewLineTarget, saveManualSyncDraft, sungLines, syncDisplayText, syncLyricLine, type DraftStorage } from "./manual-lyric-sync";

const line = (id: string, text: string, startSeconds: number, endSeconds: number): LyricLine => ({ id, text, startSeconds, endSeconds, words: [{ id: `${id}-word`, text, startSeconds, endSeconds, syllables: [{ id: `${id}-syllable`, text, startSeconds, endSeconds, noteIds: [] }] }] });
const alignment: LyricAlignment = { version: 1, authoritativeText: "პირველი\n[Verse]\nმეორე\nმესამე", source: "forced-alignment", confidence: "review", lines: [line("one", "პირველი", 1, 3), line("marker", "[Verse]", 3, 4), line("two", "მეორე", 4, 6), line("three", "მესამე", 7, 9)] };
const manifest = { version: 1, songId: "song-1", slug: "song", generatedAt: "", sourceAudioSha256: "abc", melodySource: "test", sourceConfidence: "review", audio: { originalUrl: "song.mp3", instrumentalUrl: null, vocalUrl: null }, originalNotes: [], continuousNotes: [], alignment, chords: [], diagnostics: { noteCount: 0, pitchMin: null, pitchMax: null, medianNoteDurationMs: 0, shortNoteRejectionCount: 0, octaveCorrectionCount: 0, longestSilenceMs: 0, pitchConfidence: 0, monophonyRatio: 1, status: "review" }, exports: {} } satisfies KaraokeArtifactManifest;
class MemoryStorage implements DraftStorage { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } removeItem(key: string) { this.values.delete(key); } }
const syncAll = () => {
  let session = createManualSyncSession(manifest, "created");
  for (const [id, time] of [["one", 1.5], ["two", 4.5], ["three", 7.5]] as const) { const result = syncLyricLine(session, alignment, id, time, `sync-${id}`); if (!result.ok) throw new Error(result.message); session = result.session; }
  return session;
};

describe("guided manual lyric synchronization", () => {
  it("derives sync text without changing bracketed source content", () => {
    expect(analyzeSyncLyricLine(line("a", "[Verse 1]", 0, 1))).toMatchObject({ status: "production-only", displayText: "" });
    expect(analyzeSyncLyricLine(line("b", "[Male Vocal] ჩვენ განვშორდებით [softly]", 0, 1))).toMatchObject({ status: "syncable", displayText: "ჩვენ განვშორდებით", productionDirections: ["[Male Vocal]", "[softly]"] });
    expect(analyzeSyncLyricLine(line("c", "[One] [Two] —", 0, 1))).toMatchObject({ status: "production-only", displayText: "" });
    expect(analyzeSyncLyricLine(line("d", "[Call: ჰეი]", 0, 1))).toMatchObject({ status: "production-only", displayText: "" });
    const mixedAlignment = { ...alignment, lines: [line("meta", "[Male Vocal] ჩვენ განვშორდებით", 0, 1), line("direction", "[Instrumental]", 1, 2)] };
    const preview = applyManualSyncPreview(mixedAlignment, []);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ id: "meta", text: "ჩვენ განვშორდებით", words: [] });
    expect(mixedAlignment.lines[0].text).toBe("[Male Vocal] ჩვენ განვშორდებით");
  });

  it("reports malformed brackets and excludes them from the queue", () => {
    const malformed = { ...alignment, lines: [line("safe", "ტექსტი", 0, 1), line("bad", "[Male Vocal ტექსტი", 1, 2)] };
    expect(analyzeSyncLyrics(malformed)[1]).toMatchObject({ sourceLineNumber: 2, status: "needs-review", displayText: "" });
    expect(sungLines(malformed).map((item) => item.id)).toEqual(["safe"]);
  });

  it("keeps stable source identities while skipping consecutive directions", () => {
    const consecutive = { ...alignment, lines: [line("source-10", "პირველი", 0, 1), line("source-11", "[Verse]", 1, 2), line("source-12", "[Instrumental]", 2, 3), line("source-13", "[Male Vocal] მეორე", 3, 4)] };
    expect(nextSungLineId(consecutive, "source-10")).toBe("source-13");
    expect(syncDisplayText(consecutive, "source-13")).toBe("მეორე");
    expect(sungLines(consecutive).map((item) => item.id)).toEqual(["source-10", "source-13"]);
  });

  it("captures playback time and advances past non-sung markers", () => {
    const result = syncLyricLine(createManualSyncSession(manifest), alignment, "one", 2.3456, "synced");
    if (!result.ok) throw new Error(result.message);
    expect(result.session.draft.overrides[0]).toEqual({ lineId: "one", startSeconds: 2.346, syncedAt: "synced" });
    expect(result.selectedLineId).toBe("two"); expect(nextSungLineId(alignment, "one")).toBe("two");
  });

  it("autosaves and automatically restores only a matching identity", () => {
    const storage = new MemoryStorage(); const session = syncAll(); saveManualSyncDraft(storage, manifest, session);
    expect(restoreManualSyncDraft(storage, manifest)?.draft).toEqual(session.draft);
    expect(restoreManualSyncDraft(storage, { ...manifest, sourceAudioSha256: "different" })).toBeNull();
    const raw = storage.getItem(manualSyncStorageKey(manifest))!; storage.setItem(manualSyncStorageKey(manifest), raw.replace('"songId": "song-1"', '"songId": "other"'));
    expect(restoreManualSyncDraft(storage, manifest)).toBeNull();
  });

  it("migrates existing timings by dropping newly excluded metadata lines only", () => {
    const draft = createManualSyncSession(manifest, "created").draft;
    const raw = JSON.stringify({ ...draft, overrides: [{ lineId: "one", startSeconds: 1.5, syncedAt: "one" }, { lineId: "marker", startSeconds: 3.5, syncedAt: "marker" }, { lineId: "two", startSeconds: 4.5, syncedAt: "two" }] });
    expect(importManualSyncDraft(raw, manifest).draft.overrides.map((item) => item.lineId)).toEqual(["one", "two"]);
  });

  it("reports progress using sung lines only", () => {
    const result = syncLyricLine(createManualSyncSession(manifest), alignment, "one", 1.5); if (!result.ok) throw new Error(result.message);
    expect(manualSyncProgress(result.session, alignment)).toEqual({ synced: 1, total: 3 });
  });

  it("finishes through a validated serialization round-trip", () => {
    const finished = finishManualSync(syncAll(), manifest, "reviewed");
    expect(finished.ok).toBe(true); if (!finished.ok) return;
    expect(finished.session.draft.status).toBe("review"); expect(JSON.parse(finished.serialized).authoritativeText).toBe(alignment.authoritativeText);
    expect(finished.firstStartSeconds).toBe(1.5);
  });

  it("navigates review lines to their captured starts", () => {
    const session = syncAll();
    expect(reviewLineTarget(session, alignment, "two", "previous")).toEqual({ lineId: "one", startSeconds: 1.5 });
    expect(reviewLineTarget(session, alignment, "two", "current")).toEqual({ lineId: "two", startSeconds: 4.5 });
    expect(reviewLineTarget(session, alignment, "two", "next")).toEqual({ lineId: "three", startSeconds: 7.5 });
  });

  it("fixes one line without changing any other captured timing", () => {
    const before = syncAll(); const fixing = fixManualSyncLine(before, "two", "fixing");
    const result = syncLyricLine(fixing, alignment, "two", 5, "fixed"); if (!result.ok) throw new Error(result.message);
    expect(result.session.draft.overrides.map(({ lineId, startSeconds }) => [lineId, startSeconds])).toEqual([["one", 1.5], ["two", 5], ["three", 7.5]]);
  });

  it("records owner approval and preserves canonical text", () => {
    const canonicalSnapshot = alignment.authoritativeText; const approved = approveManualSync(syncAll(), "approved"); const preview = applyManualSyncPreview(alignment, approved.draft.overrides);
    expect(approved.draft).toMatchObject({ status: "approved", approvedAt: "approved" }); expect(preview.authoritativeText).toBe(alignment.authoritativeText);
    expect(alignment.authoritativeText).toBe(canonicalSnapshot);
  });

  it("rejects overlap, non-positive source windows, and shortcut use in inputs", () => {
    const later = syncLyricLine(createManualSyncSession(manifest), alignment, "two", 5); if (!later.ok) throw new Error(later.message);
    expect(syncLyricLine(later.session, alignment, "one", 5)).toMatchObject({ ok: false });
    const invalid = { ...alignment, lines: [line("bad", "bad", 2, 2)] }; expect(syncLyricLine(createManualSyncSession({ ...manifest, alignment: invalid }), invalid, "bad", 2)).toMatchObject({ ok: false });
    expect(isManualSyncShortcut({ key: "s", target: { tagName: "INPUT" } as unknown as EventTarget, ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});
