import { validateLearningArtifactIdentity } from "./artifact-identity";
import { resolveLearningArtifact, type LearningArtifactInstrument, type LearningArtifactManifest } from "./melody-artifacts";
import type { ScoreManifest } from "./contracts";
import { manifestFromMidi } from "./midi-manifest";
import { buildVoiceLanes, selectMelodyLane } from "./voice-lanes";
import { composeLearningMelody, type LearningMelody } from "./learning-melody";

export type LearningSourceMode = "original" | "melody" | "fullSong";
export const sourceControlsHtml = '<fieldset class="learning-control-group learning-segments" data-l="source-mode" hidden><legend>SOURCE</legend><button type="button" data-source-mode="original" aria-pressed="false">ORIGINAL</button><button type="button" data-source-mode="melody" aria-pressed="false">MELODY</button><button type="button" data-source-mode="fullSong" aria-pressed="false">FULL SONG</button></fieldset>';

export interface LearningSourceAvailability {
  available: LearningSourceMode[];
  initial: LearningSourceMode | null;
}

export async function discoverOriginalSource<T>(options: {
  loadApi?: () => Promise<T>;
  loadMidi?: () => Promise<T>;
  staticAvailable: boolean;
  isApiUnavailable(error: unknown): boolean;
}): Promise<{ source: T | null; local: boolean }> {
  if (options.loadApi) {
    try { return { source: await options.loadApi(), local: false }; }
    catch (error) {
      if (options.loadMidi) return { source: await options.loadMidi(), local: true };
      if (!options.staticAvailable && !options.isApiUnavailable(error)) throw error;
    }
  } else if (options.loadMidi) return { source: await options.loadMidi(), local: true };
  return { source: null, local: false };
}

export function resolveLearningSourceAvailability(
  hasOriginal: boolean,
  manifest: LearningArtifactManifest | null,
  instrument: LearningArtifactInstrument = "piano",
): LearningSourceAvailability {
  const available: LearningSourceMode[] = [];
  if (hasOriginal) available.push("original");
  if (manifest && resolveLearningArtifact(manifest, instrument, "melody").available) available.push("melody");
  if (manifest && resolveLearningArtifact(manifest, instrument, "fullSong").available) available.push("fullSong");
  return { available, initial: available.includes("original") ? "original" : available.includes("melody") ? "melody" : available[0] ?? null };
}

export function staticArtifactUrl(root: HTMLElement, manifest: LearningArtifactManifest, instrument: LearningArtifactInstrument, mode: "melody" | "fullSong"): string | null {
  const resource = resolveLearningArtifact(manifest, instrument, mode);
  if (!resource.available || !resource.url || !root.dataset.learningArtifactsUrl) return null;
  return new URL(resource.url, new URL(root.dataset.learningArtifactsUrl, window.location.href)).toString();
}

export async function resolveInitialLearningManifest(options: {
  root: HTMLElement;
  songId: string;
  original: ScoreManifest | null;
  artifacts: LearningArtifactManifest | null;
  instrument: LearningArtifactInstrument;
}): Promise<{ manifest: ScoreManifest | null; availability: LearningSourceAvailability }> {
  const availability = resolveLearningSourceAvailability(Boolean(options.original), options.artifacts, options.instrument);
  if (options.original || !options.artifacts || !availability.initial) return { manifest: options.original, availability };
  const mode = availability.initial === "fullSong" ? "fullSong" : "melody";
  const url = staticArtifactUrl(options.root, options.artifacts, options.instrument, mode);
  return { manifest: url ? await manifestFromMidi(options.songId, url) : null, availability };
}

export async function loadStaticLearningMelody(songId: string, url: string): Promise<LearningMelody> {
  const manifest = await manifestFromMidi(songId, url);
  const lanes = buildVoiceLanes(manifest);
  const lane = selectMelodyLane(manifest, lanes) ?? lanes[0] ?? null;
  if (!lane) throw new Error("Static melody contains no playable notes.");
  return composeLearningMelody(manifest.timeline, lanes, { primaryLane: lane, manualPrimary: true });
}

export async function discoverStaticArtifacts(root: HTMLElement, signal: AbortSignal): Promise<LearningArtifactManifest | null> {
  const url = root.dataset.learningArtifactsUrl;
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: "omit", signal });
    if (!response.ok) return null;
    const candidate = await response.json() as LearningArtifactManifest;
    if (candidate.schemaVersion !== "zura-learning-artifacts/v1") return null;
    const identity = validateLearningArtifactIdentity({ slug: root.dataset.learningSongSlug, generationId: root.dataset.learningGenerationId, canonicalAudioSha256: root.dataset.learningAudioSha256 }, candidate.song);
    return identity.accepted ? candidate : null;
  } catch { return null; }
}

export function bindStaticSourceControls(options: {
  root: HTMLElement;
  controls: HTMLElement;
  manifest: LearningArtifactManifest;
  availability: LearningSourceAvailability;
  initialMode: LearningSourceMode;
  instrument(): string;
  activateOriginal(): Promise<void>;
  activateStatic(url: string, instrument: LearningArtifactInstrument, mode: "melody" | "fullSong"): Promise<void>;
  report(message: string): void;
}): void {
  const setPressed = (mode: string) => options.controls.querySelectorAll<HTMLButtonElement>("[data-source-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sourceMode === mode)));
  options.controls.querySelectorAll<HTMLButtonElement>("[data-source-mode]").forEach((button) => { button.hidden = !options.availability.available.includes(button.dataset.sourceMode as LearningSourceMode); });
  options.controls.hidden = false;
  setPressed(options.initialMode);
  const original = options.controls.querySelector<HTMLButtonElement>('[data-source-mode="original"]')!;
  original.onclick = async () => { await options.activateOriginal(); setPressed("original"); };
  for (const mode of ["melody", "fullSong"] as const) options.controls.querySelector<HTMLButtonElement>(`[data-source-mode="${mode}"]`)!.onclick = async () => {
    const selected = options.instrument();
    const instrument = (selected === "guitar" || selected === "accordion" ? selected : "piano") as LearningArtifactInstrument;
    const url = staticArtifactUrl(options.root, options.manifest, instrument, mode);
    if (!url) { options.report(`${mode === "melody" ? "Melody" : "Full Song"} unavailable.`); return; }
    await options.activateStatic(url, instrument, mode);
    setPressed(mode);
  };
}
