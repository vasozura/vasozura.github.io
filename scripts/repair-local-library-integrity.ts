import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import midiPackage from "@tonejs/midi";

const { Midi } = midiPackage as unknown as typeof import("@tonejs/midi");
const root = path.resolve(process.env.COMPOSER_ARCHIVE_ROOT || "D:\\ComposerArchive");
const databasePath = path.join(root, "02_DATABASE", "library.db");
const apply = process.argv.includes("--apply");
const now = new Date().toISOString();

type Asset = {
  id: number;
  song_id: string;
  local_path: string;
  sha256: string;
  format: string;
  metadata_json: string;
};

function sha256(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

async function validate(asset: Asset): Promise<Record<string, unknown>> {
  const size = statSync(asset.local_path).size;
  if (size <= 0) throw new Error(`Asset ${asset.id} is empty.`);
  if (asset.format === "midi") {
    const midi = new Midi(readFileSync(asset.local_path));
    if (midi.duration <= 0) throw new Error(`Asset ${asset.id} has no positive MIDI duration.`);
    return { duration: midi.duration, tracks: midi.tracks.length, notes: midi.tracks.reduce((sum, track) => sum + track.notes.length, 0) };
  }
  if (asset.format === "wav" || asset.format === "mp3") {
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,sample_rate,channels", "-of", "json", asset.local_path], { encoding: "utf8", windowsHide: true })) as {
      format?: { duration?: string };
      streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
    };
    const stream = probe.streams?.[0];
    const duration = Number(probe.format?.duration);
    if (!duration || duration <= 0) throw new Error(`Asset ${asset.id} has no positive audio duration.`);
    return {
      duration,
      sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : null,
      channels: stream?.channels ?? null,
      codec: stream?.codec_name ?? null,
    };
  }
  return JSON.parse(asset.metadata_json) as Record<string, unknown>;
}

function songRoot(filename: string): string {
  const marker = `${path.sep}01_LIBRARY${path.sep}songs${path.sep}`;
  const start = filename.indexOf(marker);
  if (start < 0) throw new Error(`Asset is outside the song library: ${filename}`);
  const relative = filename.slice(start + marker.length);
  const folder = relative.split(path.sep)[0];
  if (!folder) throw new Error(`Cannot resolve song root: ${filename}`);
  return filename.slice(0, start + marker.length + folder.length);
}

if (!existsSync(databasePath)) throw new Error(`Library database not found: ${databasePath}`);
const db = new DatabaseSync(databasePath);
const assets = db.prepare("SELECT id,song_id,local_path,sha256,format,metadata_json FROM assets ORDER BY id").all() as unknown as Asset[];
const songs = db.prepare("SELECT id,source_index,slug,title FROM songs").all() as Array<{ id: string; source_index: number | null; slug: string; title: string }>;
const songById = new Map(songs.map((song) => [song.id, song]));
const mismatches: Array<Asset & { actual_sha256: string; metadata: Record<string, unknown> }> = [];

for (const asset of assets) {
  if (!existsSync(asset.local_path)) continue;
  const actual = sha256(asset.local_path);
  if (actual !== asset.sha256) mismatches.push({ ...asset, actual_sha256: actual, metadata: await validate(asset) });
}

const affected = [...new Set(mismatches.map((asset) => songById.get(asset.song_id)?.slug).filter((slug): slug is string => Boolean(slug)))].sort();
const metadataReviewSongIds = [...new Set(assets.filter((asset) => existsSync(asset.local_path) && !existsSync(path.join(songRoot(asset.local_path), "metadata.json"))).map((asset) => asset.song_id))];
const report = {
  generated_at: now,
  applied: apply,
  mismatch_count: mismatches.length,
  affected_slugs: affected,
  metadata_review_count: metadataReviewSongIds.length,
  metadata_review_slugs: metadataReviewSongIds.map((id) => songById.get(id)?.slug ?? id).sort(),
  mismatches: mismatches.map((asset) => ({
    id: asset.id,
    slug: songById.get(asset.song_id)?.slug ?? null,
    path: asset.local_path,
    previous_sha256: asset.sha256,
    actual_sha256: asset.actual_sha256,
  })),
};

if (apply && mismatches.length) {
  const backupDir = path.join(root, "04_BACKUP");
  mkdirSync(backupDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-");
  const backup = path.join(backupDir, `library-before-integrity-repair-${stamp}.db`);
  copyFileSync(databasePath, backup);
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare("UPDATE assets SET sha256=?,file_size=?,duration_seconds=?,sample_rate=?,channels=?,metadata_json=?,validation_state='LOCAL_VALIDATED' WHERE id=? AND sha256=?");
    const event = db.prepare("INSERT INTO validation_events(asset_id,state,detail,recorded_at) VALUES(?,?,?,?)");
    for (const asset of mismatches) {
      const result = update.run(
        asset.actual_sha256,
        statSync(asset.local_path).size,
        Number(asset.metadata.duration ?? 0) || null,
        asset.metadata.sampleRate == null ? null : Number(asset.metadata.sampleRate),
        asset.metadata.channels == null ? null : Number(asset.metadata.channels),
        JSON.stringify(asset.metadata),
        asset.id,
        asset.sha256,
      );
      if (Number(result.changes) !== 1) throw new Error(`Concurrent change detected for asset ${asset.id}.`);
      event.run(asset.id, "LOCAL_VALIDATED", JSON.stringify({ reason: "integrity-repair", previous_sha256: asset.sha256, sha256: asset.actual_sha256, ...asset.metadata }), now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const affectedSongIds = new Set(mismatches.map((asset) => asset.song_id));
  for (const asset of assets) {
    if (!existsSync(asset.local_path)) continue;
    const rootFolder = songRoot(asset.local_path);
    if (!existsSync(path.join(rootFolder, "metadata.json"))) affectedSongIds.add(asset.song_id);
  }
  for (const songId of affectedSongIds) {
    const row = db.prepare("SELECT * FROM songs WHERE id=?").get(songId);
    const rows = db.prepare("SELECT asset_role,format,local_path,file_size,sha256,validation_state FROM assets WHERE song_id=? ORDER BY asset_role,id").all(songId);
    const representative = assets.find((asset) => asset.song_id === songId && existsSync(asset.local_path));
    if (!representative) continue;
    const rootFolder = songRoot(representative.local_path);
    writeFileSync(path.join(rootFolder, "metadata.json"), JSON.stringify({ schemaVersion: "composer-archive/manual-master-v1", song: row, assets: rows }, null, 2));
    writeFileSync(path.join(rootFolder, "hashes.json"), JSON.stringify({ schemaVersion: "composer-archive/manual-master-v1", assets: rows }, null, 2));
  }
  const logDir = path.join(root, "05_LOGS");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, `integrity-repair-${stamp}.json`), JSON.stringify(report, null, 2));
}

db.close();
console.log(JSON.stringify(report, null, 2));
