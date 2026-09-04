export const LEARNING_API_VERSION = "v1" as const;
export type Hand = "left" | "right" | "unknown";
export interface Part { id:string; name:string; instrument:string; midiChannel:number|null; hand:Hand; }
export interface Measure { index:number; number:string; startSeconds:number; durationSeconds:number; beats:number; beatType:number; pickup:boolean; repeatStart?:boolean; repeatEnd?:boolean; }
export interface NoteEvent { id:string; partId:string; measureIndex:number; beat:number; startSeconds:number; durationSeconds:number; midi:number; velocity:number; hand:Hand; cursorStep?:number; tieStart?:boolean; tieStop?:boolean; chord?:boolean; string?:number; fret?:number; }
export interface TempoEvent { atSeconds:number; bpm:number; measureIndex:number; }
export interface TimeSignature { atSeconds:number; beats:number; beatType:number; measureIndex:number; }
export interface Timeline { version:typeof LEARNING_API_VERSION; durationSeconds:number; notes:NoteEvent[]; tempos:TempoEvent[]; timeSignatures:TimeSignature[]; measures:Measure[]; }
export interface ScoreManifest { version:typeof LEARNING_API_VERSION; songId:string; sourceChecksum:string; generatedAt:string; parts:Part[]; timeline:Timeline; warnings:string[]; }
export interface FingeringCandidate { instrument:"guitar"|"accordion"|"piano"; noteId:string; rank:number; confidence:"explicit"|"suggestion"; string?:number; fret?:number; button?:string; finger?:number; reason:string; }
export type PracticeMode="listen"|"wait-for-note"|"continuous";
export interface Exercise { id:string; songId:string; partIds:string[]; fromMeasure:number; toMeasure:number; tempoPercent:number; mode:PracticeMode; timingToleranceMs:number; }
export interface AttemptEvent { midi:number; startedAtMs:number; durationMs:number; velocity:number; }
export interface AttemptFeedback { status:"correct"|"wrong_pitch"|"missed"|"extra"; sourceNoteId:string|null; expectedMidi:number|null; playedMidi:number|null; onsetDeltaMs:number|null; measureNumber:number|null; beat:number|null; partId:string|null; }
export interface AttemptResult { exerciseId:string; pitchScore:number; timingScore:number; durationScore:number; completion:number; streak:number; pausedForTiming:boolean; wrong:number[]; missed:string[]; feedback:AttemptFeedback[]; }
export interface ProgressSummary { songId:string; userId:string|null; completedExercises:number; bestScore:number; streak:number; lastPracticedAt:string|null; practiceSeconds?:number; }
export interface ExerciseSelection { partIds:string[]; fromMeasure:number; toMeasure:number; tempoPercent:number; }
export interface LearningAttemptSummary { id:string; exerciseId:string; evaluatedAt:string; pitchScore:number; timingScore:number; completion:number; streak:number; instruments:string[]; }
export interface LearnerProgress { attempts:number; bestScore:number|null; recentScore:number|null; totalPracticeSeconds:number; streak:number; lastPracticedAt:string|null; }
export interface LearningResetResult { deletedAttempts:number; deletedProgressEntries:number; }
export interface LearningApiError { code:string; message:string; requestId?:string; details?:Record<string,unknown>; }

export function isScoreManifest(value: unknown): value is ScoreManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ScoreManifest>;
  return manifest.version === LEARNING_API_VERSION && typeof manifest.songId === "string" && Array.isArray(manifest.parts) && !!manifest.timeline && manifest.timeline.version === LEARNING_API_VERSION && Array.isArray(manifest.timeline.notes) && Array.isArray(manifest.timeline.measures) && manifest.timeline.measures.every((measure, index) => measure.index === index && measure.durationSeconds >= 0);
}

export function assertScoreManifest(value: unknown): ScoreManifest {
  if (!isScoreManifest(value)) throw new Error("Learning manifest does not satisfy contract v1.");
  return value;
}
