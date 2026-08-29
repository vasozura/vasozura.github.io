# Learning API integration contract

The production base URL is configured with `VITE_LEARNING_API_URL`. The current
deployment is `https://zura-learning-api.onrender.com`; no server credential is
included in the frontend.

`src/lib/zura-api` is a checked-in snapshot of the TypeScript client generated
from the API repository's OpenAPI schema. Update that directory and the JSON
contract fixtures together from `clients/typescript` whenever the API contract
changes. Application code uses the adapter in `src/learning/api-client.ts` and
does not maintain a second set of transport models.

The client contract is:

- `GET /v1/scores/{song_id}/manifest` and `/timeline` are anonymous reads for a
  published learning score. These requests explicitly omit Authorization and
  cookies.
- `POST /v1/exercises/generate`, `/v1/attempts/evaluate`, and `/v1/progress`
  are protected. Immediately before each protected request, the client asks
  Supabase Auth for the current short-lived access token and sends it as a
  bearer token. The generated client never persists the token.
- CORS allows the GitHub Pages origin, JSON requests, and the Authorization
  header. Requests use `credentials: "omit"`.
- API failures retain the generated stable error code, HTTP status, and request
  id. Only network failures and timeouts may fall back to the deterministic
  local MIDI adapter; authorization, validation, and contract failures do not.
- A local fallback is available only when a valid MIDI resource exists. If the
  score is not learning-enabled or no usable score resource exists, learning
  controls remain hidden.

The generated schema is authoritative for snake_case wire objects. The
frontend adapter maps those objects to the existing camelCase scheduler and
visualizer domain model. Piano, guitar, accordion, MIDI parsing, and
OpenSheetMusicDisplay remain lazy-loaded with the learning/score route.
