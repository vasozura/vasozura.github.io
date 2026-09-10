/* Karaoke artifact delivery.
 *
 * Uploads one prepared output directory to the `karaoke` Storage bucket and records the manifest
 * URL in `songs.learning_mapping.karaokeManifestUrl`, which is the single reference the song page
 * reads. Nothing about the song's publication state, its files, or its lyrics is changed.
 *
 *   pnpm publish:karaoke -- --input=tmp/karaoke/song-slug --dry-run
 *   pnpm publish:karaoke -- --input=tmp/karaoke/song-slug --include-video
 *
 * Credentials come from the environment, never from an argument: SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, the same pair scripts/import-song.ts uses. --dry-run needs neither and
 * prints exactly what a real run would upload, so the plan can be reviewed before any write.
 *
 * The service-role key is never printed, never written into a generated file and never sent
 * anywhere but the Supabase project named by SUPABASE_URL. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { KaraokeArtifactManifest, KaraokeExportKey } from "../src/karaoke/contracts";
import { isTrustedServerCredential } from "./import-song";

export interface KaraokeUploadItem {
  /** Path inside the prepared directory, as written in the manifest. */
  localPath: string;
  objectPath: string;
  contentType: string;
  exportKey: KaraokeExportKey | "manifest";
}

export interface KaraokeUploadPlan {
  slug: string;
  songId: string;
  prefix: string;
  manifestObjectPath: string;
  items: KaraokeUploadItem[];
  skipped: Array<{ exportKey: string; reason: string }>;
}

const contentTypes: Record<string, string> = {
  ".json": "application/json",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".lrc": "text/plain",
  ".srt": "text/plain",
  ".ass": "text/plain",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
};

export function karaokeContentType(file: string): string {
  return contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Rendered video and the raw guide WAV are large and are not needed for browser playback, so they
 *  stay out of a normal publish. `--include-video` opts the MP4s in for a channel upload. */
const videoKeys = new Set<string>(["mp4", "mp4Shorts", "mp4Square", "mp4Guide", "mp4GuideShorts", "mp4GuideSquare"]);

export interface PlanOptions {
  includeVideo?: boolean;
  /** Overrides the checksum prefix; only used to keep tests readable. */
  prefix?: string;
}

/** What a publish would upload, decided from the manifest alone. Pure, so it can be reviewed with
 *  --dry-run and asserted in tests without Supabase. */
export function planKaraokeUpload(manifest: KaraokeArtifactManifest, options: PlanOptions = {}): KaraokeUploadPlan {
  if (!manifest.slug) throw new Error("The manifest has no slug, so its Storage prefix cannot be derived.");
  if (!manifest.sourceAudioSha256) throw new Error("The manifest has no canonical audio checksum.");
  const prefix = options.prefix ?? manifest.sourceAudioSha256.slice(0, 12);
  const base = `${manifest.slug}/${prefix}`;
  const items: KaraokeUploadItem[] = [];
  const skipped: KaraokeUploadPlan["skipped"] = [];
  for (const [key, value] of Object.entries(manifest.exports)) {
    if (!value) continue;
    if (videoKeys.has(key) && !options.includeVideo) { skipped.push({ exportKey: key, reason: "rendered video is excluded unless --include-video is passed" }); continue; }
    const relative = value.replace(/^\.\//, "");
    if (relative.startsWith("../") || path.isAbsolute(relative)) { skipped.push({ exportKey: key, reason: "export path escapes the prepared directory" }); continue; }
    items.push({ localPath: relative, objectPath: `${base}/${relative}`, contentType: karaokeContentType(relative), exportKey: key as KaraokeExportKey });
  }
  const instrumental = manifest.audio.instrumentalUrl?.replace(/^\.\//, "");
  if (instrumental) items.push({ localPath: instrumental, objectPath: `${base}/${instrumental}`, contentType: karaokeContentType(instrumental), exportKey: "guideAudio" });
  items.sort((left, right) => left.objectPath.localeCompare(right.objectPath));
  return { slug: manifest.slug, songId: manifest.songId, prefix, manifestObjectPath: `${base}/manifest.json`, items, skipped };
}

/** The manifest as it should be stored: identical to the prepared one except that artifacts the
 *  publish left behind are removed, so a download link can never point at a missing object. */
export function manifestForUpload(manifest: KaraokeArtifactManifest, plan: KaraokeUploadPlan): KaraokeArtifactManifest {
  const published = new Set(plan.items.map((item) => item.exportKey));
  const exports = Object.fromEntries(Object.entries(manifest.exports).filter(([key, value]) => Boolean(value) && published.has(key as KaraokeExportKey)));
  return {
    ...manifest,
    exports,
    renders: (manifest.renders ?? []).filter((render) => published.has(render.exportKey)),
  };
}

export function publicManifestUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/karaoke/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

const argument = (name: string): string | null => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

async function main(): Promise<number> {
  const input = argument("input");
  if (!input) throw new Error("--input=<prepared output directory> is required.");
  const directory = path.resolve(input);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as KaraokeArtifactManifest;
  const dryRun = process.argv.includes("--dry-run");
  const plan = planKaraokeUpload(manifest, { includeVideo: process.argv.includes("--include-video") });

  const missing: string[] = [];
  let bytes = 0;
  for (const item of plan.items) {
    const file = path.join(directory, item.localPath);
    const stats = await stat(file).catch(() => null);
    if (!stats?.isFile()) missing.push(item.localPath);
    else bytes += stats.size;
  }
  if (missing.length) throw new Error(`The manifest references files that are not in the prepared directory: ${missing.join(", ")}`);

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true, slug: plan.slug, songId: plan.songId, bucket: "karaoke", manifestObjectPath: plan.manifestObjectPath,
      objects: plan.items.length + 1, megabytes: Number((bytes / 1048576).toFixed(2)),
      uploads: plan.items.map((item) => ({ exportKey: item.exportKey, objectPath: item.objectPath, contentType: item.contentType })),
      skipped: plan.skipped,
      writes: `songs.learning_mapping.karaokeManifestUrl for song ${plan.songId}`,
    }, null, 2));
    return 0;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !isTrustedServerCredential(key)) {
    // Deliberately names the variables and nothing else: no value is ever echoed.
    throw new Error("A trusted local SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY are required to publish Karaoke artifacts. Re-run with --dry-run to review the plan without credentials.");
  }
  const supabase: SupabaseClient = createClient(url, key!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: song, error: songError } = await supabase.from("songs").select("id,slug,status,lyrics_ka,learning_mapping").eq("id", plan.songId).maybeSingle();
  if (songError) throw songError;
  if (!song) throw new Error(`No song row matches the manifest song id ${plan.songId}.`);
  if (song.slug !== plan.slug) throw new Error(`The manifest slug (${plan.slug}) does not match the song row (${String(song.slug)}).`);
  if (song.status !== "published") throw new Error(`Song ${plan.slug} is ${String(song.status)}. Karaoke artifacts are only published for published songs, because the bucket is publicly readable.`);
  const lyrics = typeof song.lyrics_ka === "string" ? song.lyrics_ka.replace(/\r\n/g, "\n").trim() : "";
  if (lyrics !== manifest.alignment.authoritativeText) throw new Error("The prepared alignment was built from different lyrics than the song row holds. Re-run the preparation against the current authoritative lyrics.");

  const stored = manifestForUpload(manifest, plan);
  const uploaded: string[] = [];
  for (const item of plan.items) {
    const body = await readFile(path.join(directory, item.localPath));
    const { error } = await supabase.storage.from("karaoke").upload(item.objectPath, body, { contentType: item.contentType, upsert: true });
    if (error) throw error;
    uploaded.push(item.objectPath);
  }
  const manifestBody = Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, "utf8");
  const { error: manifestError } = await supabase.storage.from("karaoke").upload(plan.manifestObjectPath, manifestBody, { contentType: "application/json", upsert: true });
  if (manifestError) throw manifestError;
  uploaded.push(plan.manifestObjectPath);

  const manifestUrl = publicManifestUrl(url, plan.manifestObjectPath);
  const mapping = { ...(song.learning_mapping && typeof song.learning_mapping === "object" ? song.learning_mapping as Record<string, unknown> : {}), karaokeManifestUrl: manifestUrl };
  const { error: updateError } = await supabase.from("songs").update({ learning_mapping: mapping }).eq("id", plan.songId);
  if (updateError) throw updateError;

  console.log(JSON.stringify({
    slug: plan.slug, songId: plan.songId, objects: uploaded.length,
    manifestSha256: createHash("sha256").update(manifestBody).digest("hex"),
    karaokeManifestUrl: manifestUrl, publicationStateChanged: false,
  }, null, 2));
  return 0;
}

// Importing this file for its planning helpers must not start a publish.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
