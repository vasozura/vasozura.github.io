import { appConfig } from "../config";
import { ZuraLearningClient } from "../lib/zura-api";
import { getSupabase } from "../lib/supabase";
import type { Song } from "../types/song";
import { validateLearningPublication } from "./admin-config";

export interface LearningReadiness {
  ready: boolean;
  problems: string[];
  manifestKey: string | null;
  checksum: string | null;
  versions: { schema: string; parser: string; mapping: string } | null;
  processingState: "ready" | "not-configured" | "unavailable";
}

function client(): ZuraLearningClient {
  if (!appConfig.hasLearningApi) throw new Error("Learning API is not configured.");
  return new ZuraLearningClient({
    baseUrl: appConfig.learningApiUrl,
    timeoutMs: 30_000,
    getAccessToken: async () => (await getSupabase()?.auth.getSession())?.data.session?.access_token ?? null,
    retry: { maxRetries: 2, retryWrites: false },
  });
}

export async function inspectLearningReadiness(song: Song, signal?: AbortSignal): Promise<LearningReadiness> {
  const problems: string[] = [];
  try { validateLearningPublication(song); } catch (error) { problems.push(error instanceof Error ? error.message : "Invalid learning configuration."); }
  if (!song.learningEnabled) return { ready: true, problems, manifestKey: null, checksum: null, versions: null, processingState: "not-configured" };
  try {
    const manifest = await client().getManifest(song.id, {}, { signal });
    if (song.learningSource === "musicxml" && !song.musicXmlUrl) problems.push("Canonical MusicXML is missing.");
    if (manifest.source.sha256 !== song.learningMapping?.source_sha256 && song.learningMapping?.source_sha256) problems.push("Configured mapping checksum does not match the manifest source.");
    return {
      ready: problems.length === 0,
      problems,
      manifestKey: manifest.manifest_key,
      checksum: manifest.source.sha256,
      versions: { schema: manifest.versions.schema_version, parser: manifest.versions.parser_version, mapping: manifest.versions.mapping_version },
      processingState: "ready",
    };
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Learning manifest unavailable.");
    return { ready: false, problems, manifestKey: null, checksum: null, versions: null, processingState: "unavailable" };
  }
}

export async function reprocessLearning(song: Song, signal?: AbortSignal): Promise<void> {
  if (!song.learningEnabled) throw new Error("Learning is not enabled for this song.");
  await client().reprocessScore(song.id, {}, { signal, timeoutMs: 120_000 });
}
