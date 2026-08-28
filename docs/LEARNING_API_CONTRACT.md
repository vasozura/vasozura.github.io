# Learning API contract — v1

Base URL is `VITE_LEARNING_API_URL`; browser requests use JSON and `X-Learning-Api-Version: v1`. Public manifests/exercises require a published song. Attempts and progress require `Authorization: Bearer <Supabase JWT>`. CORS must allow the configured Pages origin, `GET/POST/PUT/OPTIONS`, `Authorization`, `Content-Type`, `Idempotency-Key`, and `X-Learning-Api-Version`. Server credentials and optional AI explanations never enter browser responses as credentials; explanations are advisory only.

Limits: manifest 5 MiB, attempt 10,000 events, 60 requests/minute/user, 10 second frontend timeout. `POST /attempts` requires an opaque `Idempotency-Key`; replay returns the original result. Breaking changes use a new URL major version. Deterministic parsing/scoring is authoritative; AI/LLM output is never used for pitch, rhythm, timing, fingering, or scores.

```yaml
openapi: 3.1.0
info: { title: ZURA Learning API, version: 1.0.0 }
servers: [{ url: https://learning.example.com/v1 }]
paths:
  /songs/{songId}/manifest:
    get:
      responses:
        '200': { description: ScoreManifest v1 }
  /songs/{songId}/exercises:
    get:
      responses:
        '200': { description: Exercise array }
  /exercises/{exerciseId}/attempts:
    post:
      security: [{ bearerAuth: [] }]
      parameters: [{ in: header, name: Idempotency-Key, required: true, schema: { type: string } }]
      responses:
        '200': { description: AttemptResult }
  /progress/{songId}:
    put:
      security: [{ bearerAuth: [] }]
      responses: { '200': { description: Progress saved } }
components:
  securitySchemes: { bearerAuth: { type: http, scheme: bearer, bearerFormat: Supabase-JWT } }
```

Manifest example:
```json
{"version":"v1","songId":"fixture-polyphony","sourceChecksum":"sha256:...","generatedAt":"2026-08-28T00:00:00Z","parts":[{"id":"p1","name":"Piano","instrument":"piano","midiChannel":0,"hand":"right"}],"timeline":{"version":"v1","durationSeconds":4,"notes":[{"id":"n1","partId":"p1","measureIndex":0,"beat":1,"startSeconds":0,"durationSeconds":1,"midi":60,"velocity":0.8,"hand":"right"}],"tempos":[{"atSeconds":0,"bpm":120,"measureIndex":0}],"timeSignatures":[{"atSeconds":0,"beats":4,"beatType":4,"measureIndex":0}],"measures":[{"index":0,"number":"1","startSeconds":0,"durationSeconds":2,"beats":4,"beatType":4,"pickup":false}]},"warnings":[]}
```

Attempt request/result:
```json
{"events":[{"midi":60,"startedAtMs":0,"durationMs":950,"velocity":0.8}]}
{"exerciseId":"ex1","pitchScore":100,"timingScore":100,"durationScore":95,"completion":100,"streak":1,"pausedForTiming":false,"wrong":[],"missed":[]}
```

Errors use `{"code":"rate_limited","message":"Try later","requestId":"...","details":{}}` with 400 validation, 401 auth, 403 policy, 404 missing, 409 idempotency conflict, 413 limit, 429 rate limit, and 5xx transient statuses.
