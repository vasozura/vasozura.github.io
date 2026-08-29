import {
  ZuraLearningClient,
  ZuraNetworkError,
  ZuraTimeoutError,
  type AttemptResult as ApiAttemptResult,
  type Exercise as ApiExercise,
  type ScoreManifest as ApiScoreManifest,
  type Timeline as ApiTimeline,
} from "../lib/zura-api";
import { getSupabase } from "../lib/supabase";
import type {
  AttemptEvent,
  AttemptResult,
  Exercise,
  Measure,
  NoteEvent,
  ProgressSummary,
  ScoreManifest,
} from "./contracts";

export { ZuraApiError as LearningClientError } from "../lib/zura-api";

export interface LearningApi {
  manifest(songId: string, signal?: AbortSignal): Promise<ScoreManifest>;
  exercises(songId: string, signal?: AbortSignal): Promise<Exercise[]>;
  evaluate(
    exerciseId: string,
    events: AttemptEvent[],
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AttemptResult>;
  saveProgress(summary: ProgressSummary, signal?: AbortSignal): Promise<void>;
}

const percent = (value: number | null | undefined): number => (value ?? 0) * 100;

function mapMeasure(measure: ApiScoreManifest["measures"][number]): Measure {
  const [beats, beatType] = (measure.time_signature ?? "4/4")
    .split("/")
    .map((value) => Number(value));
  return {
    index: measure.index,
    number: String(measure.number),
    startSeconds: measure.start_seconds,
    durationSeconds: Math.max(0, measure.end_seconds - measure.start_seconds),
    beats: Number.isFinite(beats) ? beats : 4,
    beatType: Number.isFinite(beatType) ? beatType : 4,
    pickup: measure.is_pickup,
  };
}

function mapNote(note: ApiTimeline["notes"][number], cursorStep: number): NoteEvent {
  return {
    id: note.id,
    partId: note.part_id,
    measureIndex: note.position.measure_index,
    beat: note.position.beat,
    startSeconds: note.start_seconds,
    durationSeconds: note.duration_seconds,
    midi: note.midi,
    velocity: note.velocity ?? 0.8,
    hand: note.fingering?.hand ?? "unknown",
    cursorStep,
    tieStart: note.tie.tie_type === "start",
    tieStop: note.tie.tie_type === "stop",
    chord: Boolean(note.chord_id),
    string: note.fingering?.string ?? undefined,
    fret: note.fingering?.fret ?? undefined,
  };
}

function mapManifest(manifest: ApiScoreManifest, timeline: ApiTimeline): ScoreManifest {
  return {
    version: "v1",
    songId: manifest.song_id,
    sourceChecksum: manifest.source.sha256,
    generatedAt: manifest.created_at,
    parts: manifest.parts.map((part) => ({
      id: part.id,
      name: part.name,
      instrument: part.instrument.family,
      midiChannel: part.instrument.midi_channel ?? null,
      hand: "unknown",
    })),
    timeline: {
      version: "v1",
      durationSeconds: timeline.duration_seconds,
      notes: timeline.notes.map(mapNote),
      tempos: timeline.tempos.map((tempo) => ({
        atSeconds: tempo.start_seconds,
        bpm: tempo.qpm,
        measureIndex: tempo.position.measure_index,
      })),
      timeSignatures: timeline.time_signatures.map((signature) => ({
        atSeconds: signature.start_seconds,
        beats: signature.numerator,
        beatType: signature.denominator,
        measureIndex: signature.position.measure_index,
      })),
      measures: manifest.measures.map(mapMeasure),
    },
    warnings: manifest.warnings.map((warning) => warning.message),
  };
}

function mapExercise(exercise: ApiExercise): Exercise {
  const measureIndexes = exercise.expected_events.map((event) => event.measure_index);
  const firstMeasure = measureIndexes.length > 0 ? Math.min(...measureIndexes) : 0;
  const lastMeasure = measureIndexes.length > 0 ? Math.max(...measureIndexes) : firstMeasure;
  return {
    id: exercise.exercise_id,
    songId: exercise.song_id,
    partIds:
      exercise.options.part_ids.length > 0
        ? exercise.options.part_ids
        : [...new Set(exercise.expected_events.map((event) => event.part_id))],
    fromMeasure: exercise.options.measure_start ?? firstMeasure,
    toMeasure: exercise.options.measure_end ?? lastMeasure,
    tempoPercent: Math.round(exercise.options.tempo_scale * 100),
    mode: "continuous",
    timingToleranceMs: 150,
  };
}

function mapAttempt(result: ApiAttemptResult): AttemptResult {
  return {
    exerciseId: result.exercise_id,
    pitchScore: percent(result.metrics.pitch_accuracy),
    timingScore: percent(result.metrics.onset_timing),
    durationScore: percent(result.metrics.duration_accuracy),
    completion: percent(result.metrics.completion),
    streak: result.metrics.longest_streak_notes,
    pausedForTiming: false,
    wrong: result.matches
      .filter((match) => match.status === "wrong_pitch" || match.status === "extra")
      .flatMap((match) => (match.played_midi == null ? [] : [match.played_midi])),
    missed: result.matches
      .filter((match) => match.status === "missed")
      .flatMap((match) => (match.source_note_id == null ? [] : [match.source_note_id])),
  };
}

export function isLearningApiUnavailable(error: unknown): boolean {
  return error instanceof ZuraNetworkError || error instanceof ZuraTimeoutError;
}

export class LearningApiClient implements LearningApi {
  private readonly client: ZuraLearningClient;
  private lastAttempt: ApiAttemptResult | null = null;

  constructor(baseUrl: string, timeoutMs = 30_000, fetchImpl?: typeof fetch) {
    this.client = new ZuraLearningClient({
      baseUrl,
      timeoutMs,
      fetch: fetchImpl,
      getAccessToken: async () => {
        const session = (await getSupabase()?.auth.getSession())?.data.session;
        return session?.access_token ?? null;
      },
      retry: { maxRetries: 2, retryWrites: false },
    });
  }

  async manifest(songId: string, signal?: AbortSignal): Promise<ScoreManifest> {
    const [manifest, timeline] = await Promise.all([
      this.client.getManifest(songId, {}, { signal, anonymous: true }),
      this.client.getTimeline(songId, {}, { signal, anonymous: true }),
    ]);
    return mapManifest(manifest, timeline);
  }

  async exercises(songId: string, signal?: AbortSignal): Promise<Exercise[]> {
    const exercise = await this.client.generateExercise(
      { song_id: songId, options: { exercise_type: "full_piece" } },
      { signal },
    );
    return [mapExercise(exercise)];
  }

  async evaluate(
    exerciseId: string,
    events: AttemptEvent[],
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AttemptResult> {
    const apiEvents = events.flatMap((event) => [
      {
        type: "note_on" as const,
        midi: event.midi,
        velocity: Math.round(event.velocity * 127),
        timestamp_seconds: event.startedAtMs / 1000,
      },
      {
        type: "note_off" as const,
        midi: event.midi,
        velocity: 0,
        timestamp_seconds: (event.startedAtMs + event.durationMs) / 1000,
      },
    ]);
    this.lastAttempt = await this.client.evaluateAttempt(
      { exercise_id: exerciseId, attempt_id: idempotencyKey, events: apiEvents },
      { signal },
    );
    return mapAttempt(this.lastAttempt);
  }

  async saveProgress(summary: ProgressSummary, signal?: AbortSignal): Promise<void> {
    const attempt = this.lastAttempt;
    if (!attempt || attempt.song_id !== summary.songId) {
      throw new Error("No evaluated attempt is available to record.");
    }
    await this.client.recordProgress(
      {
        song_id: attempt.song_id,
        exercise_id: attempt.exercise_id,
        attempt_id: attempt.attempt_id,
        correct_count: attempt.correct_count,
        expected_count: attempt.expected_count,
        completion: attempt.metrics.completion,
        longest_streak_notes: attempt.metrics.longest_streak_notes,
        practice_seconds: summary.practiceSeconds ?? attempt.attempt_duration_seconds,
      },
      { signal },
    );
  }
}
