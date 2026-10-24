import type { ScoreViewerSession, ScoreViewerSource } from "../score/score-viewer";

export type LearningSourceMode = "ORIGINAL" | "MELODY" | "FULL_SONG";
export interface LearningSessionTransferState { position: number; playing: boolean; instrument: string; activeTrackId: string; staffScope: string; cursorPosition: number; practiceMarker: number | null; loop: [number, number] | null; tempoPercent: number }
export interface LearningSourceSpec { mode: LearningSourceMode; instrument?: string; url: string; duration: number; availableTracks: readonly string[]; availableStaffScopes: readonly string[]; scoreSource?: ScoreViewerSource }
export interface LearningSourceRuntime { spec: LearningSourceSpec; capture(): LearningSessionTransferState; suspend(): void; restore(state: LearningSessionTransferState): void; resume(): void; dispose(): void }
export type LearningSourceFactory = (spec: LearningSourceSpec) => Promise<LearningSourceRuntime>;

export class LearningSourceSession {
  constructor(private runtime: LearningSourceRuntime, private readonly factory: LearningSourceFactory, private readonly score?: ScoreViewerSession) {}
  get active(): LearningSourceRuntime { return this.runtime; }
  async replace(spec: LearningSourceSpec): Promise<LearningSessionTransferState> {
    if (spec.mode === "FULL_SONG" && !spec.url) throw Error("FULL_SONG_UNAVAILABLE");
    const state = this.runtime.capture(); this.runtime.suspend();
    let next: LearningSourceRuntime;
    try { next = await this.factory(spec); } catch (error) { if (state.playing) this.runtime.resume(); throw error; }
    if (spec.scoreSource && this.score) {
      const result = await this.score.replaceSource(spec.scoreSource, { playbackSeconds: Math.min(state.position, spec.duration) });
      if (!result.ok) { next.dispose(); if (state.playing) this.runtime.resume(); throw Error(`SCORE_SOURCE_REPLACEMENT_FAILED: ${result.error ?? "unknown"}`); }
    }
    this.runtime.dispose();
    const restored: LearningSessionTransferState = { ...state, position: Math.min(state.position, spec.duration), cursorPosition: Math.min(state.cursorPosition, spec.duration), activeTrackId: spec.availableTracks.includes(state.activeTrackId) ? state.activeTrackId : (spec.availableTracks[0] ?? ""), staffScope: spec.availableStaffScopes.includes(state.staffScope) ? state.staffScope : (spec.availableStaffScopes[0] ?? ""), loop: state.loop && state.loop[0] < spec.duration ? [state.loop[0], Math.min(state.loop[1], spec.duration)] : null };
    next.restore(restored); this.score?.setPosition({ playbackSeconds: restored.position }); this.runtime = next; if (state.playing) next.resume(); return restored;
  }
  dispose(): void { this.runtime.suspend(); this.runtime.dispose(); }
}
