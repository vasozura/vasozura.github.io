/**
 * Curated aliases for the canonical models.
 *
 * `schema.d.ts` is generated from `openapi.json` and is the source of truth;
 * this file only gives the models the frontend uses most a short, stable name.
 * Nothing here is hand-maintained data - if the API contract changes,
 * regenerate `schema.d.ts` and these aliases follow automatically.
 */
import type { components } from "./schema";

type S = components["schemas"];

// --- score ------------------------------------------------------------------
export type ScoreManifest = S["ScoreManifest"];
export type ScoreSource = S["ScoreSource"];
export type Part = S["Part"];
export type Instrument = S["Instrument"];
export type Measure = S["Measure"];
export type BeatPosition = S["BeatPosition"];
export type MidiPartMapping = S["MidiPartMapping"];
export type ModelVersions = S["ModelVersions"];
export type ValidationIssue = S["ValidationIssue"];
export type ValidationReport = S["ValidationReport"];
export type ProcessingJob = S["ProcessingJob"];
export type ProcessResponse = S["ProcessResponse"];
export type PartsResponse = S["PartsResponse"];

// --- timeline ---------------------------------------------------------------
export type Timeline = S["Timeline"];
export type NoteEvent = S["NoteEvent"];
export type RestEvent = S["RestEvent"];
export type ChordEvent = S["ChordEvent"];
export type TempoEvent = S["TempoEvent"];
export type TimeSignatureEvent = S["TimeSignatureEvent"];
export type KeySignatureEvent = S["KeySignatureEvent"];
export type RepeatMarker = S["RepeatMarker"];
export type EndingMarker = S["EndingMarker"];
export type TieInfo = S["TieInfo"];
export type Articulations = S["Articulations"];

// --- practice ---------------------------------------------------------------
export type Exercise = S["Exercise"];
export type ExerciseOptions = S["ExerciseOptions"];
export type ExpectedEvent = S["ExpectedEvent"];
export type AttemptEvent = S["AttemptEvent"];
export type AttemptResult = S["AttemptResult"];
export type EvaluationTolerances = S["EvaluationTolerances"];
export type MatchDetail = S["MatchDetail"];
export type MetricBreakdown = S["MetricBreakdown"];
export type ProgressEntry = S["ProgressEntry"];
export type ProgressSummary = S["ProgressSummary"];

// --- fingering --------------------------------------------------------------
export type ExplicitFingering = S["ExplicitFingering"];
export type PianoFingeringSuggestion = S["PianoFingeringSuggestion"];
export type FingeringCandidate = S["FingeringCandidate"];
export type GuitarConfig = S["GuitarConfig"];
export type AccordionLayout = S["AccordionLayout"];
export type AccordionCandidateResult = S["AccordionCandidateResult"];
export type NoteRef = S["NoteRef"];
export type PianoFingeringRequest = S["PianoFingeringRequest"];
export type PianoFingeringResponse = S["PianoFingeringResponse"];
export type GuitarFingeringRequest = S["GuitarFingeringRequest"];
export type GuitarFingeringResponse = S["GuitarFingeringResponse"];
export type AccordionFingeringRequest = S["AccordionFingeringRequest"];

// --- meta -------------------------------------------------------------------
export type HealthResponse = S["HealthResponse"];
export type VersionResponse = S["VersionResponse"];
export type ApiErrorBody = S["ApiError"];

// --- request bodies ---------------------------------------------------------
export type ScoreValidateRequest = S["ScoreValidateRequest"];
export type ScoreProcessRequest = S["ScoreProcessRequest"];
export type ScoreReprocessRequest = S["ScoreReprocessRequest"];
export type ExerciseGenerateRequest = S["ExerciseGenerateRequest"];
export type AttemptEvaluateRequest = S["AttemptEvaluateRequest"];
export type ProgressRecordRequest = S["ProgressRecordRequest"];

/**
 * A fingering that came from the score, and is therefore authoritative.
 * Anything the API generates carries `origin: "suggested"` instead.
 */
export function isExplicitFingering(
  value: { origin?: string } | null | undefined,
): value is ExplicitFingering {
  return value?.origin === "explicit";
}

// -----------------------------------------------------------------------------
// Request input types
//
// The generated schema marks every field that has a server-side default as
// present, which is correct for a *response* - the API always sends them - but
// makes *requests* painful, because a caller would have to restate every
// default to change one value. These `…Input` aliases make defaulted fields
// optional. The client accepts them and the server fills in the rest.
// -----------------------------------------------------------------------------

/** Fields the caller must supply; everything with a server default optional. */
type WithDefaults<T, Required extends keyof T> = Pick<T, Required> & Partial<Omit<T, Required>>;

export type NoteRefInput = WithDefaults<NoteRef, "id" | "midi">;
export type GuitarConfigInput = Partial<GuitarConfig>;
export type AccordionLayoutInput = WithDefaults<AccordionLayout, "layout_id">;
export type ExerciseOptionsInput = Partial<ExerciseOptions>;
export type EvaluationTolerancesInput = Partial<EvaluationTolerances>;

export type ScoreValidateInput = WithDefaults<ScoreValidateRequest, "song_id" | "source">;
export type ScoreProcessInput = WithDefaults<ScoreProcessRequest, "song_id" | "source">;
export type ScoreReprocessInput = Partial<ScoreReprocessRequest>;

export type ExerciseGenerateInput = Omit<
  WithDefaults<ExerciseGenerateRequest, "song_id">,
  "options"
> & { options?: ExerciseOptionsInput };

export type AttemptEvaluateInput = Omit<
  WithDefaults<AttemptEvaluateRequest, "exercise_id" | "events">,
  "tolerances"
> & { tolerances?: EvaluationTolerancesInput };

export type ProgressRecordInput = WithDefaults<
  ProgressRecordRequest,
  "song_id" | "exercise_id" | "attempt_id" | "correct_count" | "expected_count" | "practice_seconds"
>;

export type PianoFingeringInput = { hand: "left" | "right"; notes: NoteRefInput[] };
export type GuitarFingeringInput = { config?: GuitarConfigInput; notes: NoteRefInput[] };
export type AccordionFingeringInput = { layout: AccordionLayoutInput; notes: NoteRefInput[] };
