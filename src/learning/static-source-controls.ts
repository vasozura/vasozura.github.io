import { validateLearningArtifactIdentity } from "./artifact-identity";
import { resolveLearningArtifact, type LearningArtifactInstrument, type LearningArtifactManifest } from "./melody-artifacts";

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
  instrument(): string;
  activateOriginal(): Promise<void>;
  activateMelody(url: string, instrument: LearningArtifactInstrument): Promise<void>;
  report(message: string): void;
}): void {
  const setPressed = (mode: string) => options.controls.querySelectorAll<HTMLButtonElement>("[data-source-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sourceMode === mode)));
  options.controls.hidden = false;
  options.controls.querySelector<HTMLButtonElement>('[data-source-mode="original"]')!.onclick = async () => { await options.activateOriginal(); setPressed("original"); };
  options.controls.querySelector<HTMLButtonElement>('[data-source-mode="melody"]')!.onclick = async () => {
    const selected = options.instrument();
    const instrument = (selected === "guitar" || selected === "accordion" ? selected : "piano") as LearningArtifactInstrument;
    const resource = resolveLearningArtifact(options.manifest, instrument, "melody");
    if (!resource.available || !resource.url) { options.report(resource.reason ?? "Melody unavailable."); return; }
    const manifestUrl = options.root.dataset.learningArtifactsUrl!;
    await options.activateMelody(new URL(resource.url, new URL(manifestUrl, window.location.href)).toString(), instrument);
    setPressed("melody");
  };
}
