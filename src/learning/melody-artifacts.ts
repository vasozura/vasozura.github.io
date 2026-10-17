export type LearningArtifactInstrument = "piano" | "guitar" | "accordion";
export type LearningArtifactMode = "original" | "melody" | "fullSong";

export interface LearningArtifactResource {
  available: boolean;
  url: string | null;
  sha256: string | null;
  strategy?: "static-midi" | "existing-learning-source" | "unavailable";
  provenance: "source-authored-midi" | "generated-canonical-melody" | "instrument-adapted-melody" | "full-song-arrangement";
}

export interface LearningArtifactManifest {
  schemaVersion: "zura-learning-artifacts/v1";
  song: { slug: string; generationId: string; canonicalAudioSha256: string };
  instruments: Record<LearningArtifactInstrument, Record<LearningArtifactMode, LearningArtifactResource>>;
}

export interface LearningArtifactResolution {
  instrument: LearningArtifactInstrument;
  mode: LearningArtifactMode;
  available: boolean;
  url: string | null;
  reason: string | null;
  strategy: "static-midi" | "existing-learning-source" | "unavailable";
}

function isSafeRelativeAssetUrl(url: string): boolean {
  if (url.startsWith("/") || url.includes("\\")) return false;
  const parts = url.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function resolveLearningArtifact(
  manifest: LearningArtifactManifest,
  instrument: LearningArtifactInstrument,
  mode: LearningArtifactMode,
): LearningArtifactResolution {
  const resource = manifest.instruments[instrument][mode];
  if (resource.available && resource.strategy === "existing-learning-source") {
    return { instrument, mode, available: true, url: null, reason: null, strategy: "existing-learning-source" };
  }
  if (!resource.available || !resource.url) {
    return { instrument, mode, available: false, url: null, reason: `${mode} is unavailable for ${instrument}.`, strategy: "unavailable" };
  }
  if (!isSafeRelativeAssetUrl(resource.url)) {
    return { instrument, mode, available: false, url: null, reason: "Artifact URL is not a safe relative path.", strategy: "unavailable" };
  }
  return { instrument, mode, available: true, url: resource.url, reason: null, strategy: "static-midi" };
}
