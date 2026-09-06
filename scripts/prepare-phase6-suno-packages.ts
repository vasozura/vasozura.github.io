import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateSunoProvenance, type SunoGenerationProvenance, type SunoPackageProvenance } from "./suno-provenance";

interface PreparationRecord {
  source_index: number;
  slug: string;
  language: string;
  youtube_url: string;
  credits: {
    composer: string;
    lyricist: string;
    translator: string | null;
  };
  canonical: SunoGenerationProvenance;
  alternates: SunoGenerationProvenance[];
}

interface PreparationFile {
  schema: "zura-phase6-suno-preparation/v1";
  workbook_sha256: string;
  project_metadata: {
    artist_name: string;
    legal_owner: string;
    rights_holder: string;
    archive_owner: string;
  };
  owner_confirmation: SunoPackageProvenance["owner_confirmation"];
  records: PreparationRecord[];
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function extractLyrics(source: string, generationId: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const marker = `Suno: https://suno.com/song/${generationId}`;
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  if (markerIndex < 0) throw new Error(`Lyrics source does not contain ${generationId}.`);
  const start = markerIndex + 2;
  const end = lines.findIndex((line, index) => index >= start && /^={20,}$/.test(line.trim()));
  if (end < 0) throw new Error(`Lyrics block for ${generationId} is not terminated.`);
  const lyrics = lines.slice(start, end).join("\n").trim();
  if (!lyrics) throw new Error(`Lyrics block for ${generationId} is empty.`);
  return `${lyrics}\n`;
}

async function writeChecksums(folder: string, filenames: string[]): Promise<void> {
  const lines: string[] = [];
  for (const filename of [...filenames].sort()) {
    const body = await readFile(path.join(folder, filename));
    lines.push(`${sha256(body)}  ${filename.replace(/\\/g, "/")}`);
  }
  await writeFile(path.join(folder, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
}

export async function preparePhase6Packages(options: {
  audioRoot: string;
  lyricsSource: string;
  output: string;
  recordsFile?: string;
}): Promise<{ batchPath: string; packages: Array<{ slug: string; path: string; audioSha256: string }> }> {
  const recordsFile = options.recordsFile ?? path.resolve("docs/phase6-suno-records.json");
  const preparation = JSON.parse(await readFile(recordsFile, "utf8")) as PreparationFile;
  if (preparation.schema !== "zura-phase6-suno-preparation/v1" || preparation.records.length !== 5) throw new Error("Phase 6 preparation file must contain exactly five versioned records.");
  await access(options.audioRoot);
  const lyricsSource = await readFile(options.lyricsSource, "utf8");
  await mkdir(options.output, { recursive: true });
  const packages: Array<{ slug: string; path: string; audioSha256: string }> = [];

  for (const record of preparation.records) {
    const folder = path.join(options.output, record.slug);
    try {
      await access(folder);
      throw new Error(`Refusing to overwrite existing package ${record.slug}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(folder);
    const local = record.canonical.local_media;
    if (!local) throw new Error(`${record.slug} is missing canonical local-media identity.`);
    const sourceAudio = path.join(options.audioRoot, local.filename);
    const audio = await readFile(sourceAudio);
    const actualSha256 = sha256(audio);
    if (actualSha256 !== local.sha256) throw new Error(`${record.slug} canonical MP3 checksum mismatch.`);
    await copyFile(sourceAudio, path.join(folder, "audio.mp3"));

    const metadata = {
      slug: record.slug,
      status: "draft",
      title_ka: record.canonical.title,
      title_en: record.canonical.title,
      display_credit: null,
      composer: record.credits.composer,
      lyricist: record.credits.lyricist,
      translator: record.credits.translator,
      language: record.language,
      description_ka: null,
      description_en: null,
      suno_url: record.canonical.url,
      youtube_url: record.youtube_url,
      duration_seconds: local.duration_seconds,
      bpm: null,
      musical_key: null,
      time_signature: null,
      difficulty: null,
      learning_enabled: false,
      learning_instruments: [],
      canonical_source: "musicxml",
      part_mapping: {},
      fingering_overrides: {},
    };
    const provenance: SunoPackageProvenance = {
      schema_version: "zura-suno-provenance/v1",
      source_index: record.source_index,
      canonical: record.canonical,
      alternates: record.alternates,
      owner_confirmation: preparation.owner_confirmation,
      readiness: {
        status: "approved",
        blockers: [],
      },
    };
    const validated = validateSunoProvenance(provenance);
    if (validated.issues.length) throw new Error(`${record.slug}: ${validated.issues.join(" ")}`);
    const lyrics = extractLyrics(lyricsSource, record.canonical.generation_id);
    const notes = [
      `Phase 6 source index: ${record.source_index}`,
      `Canonical Suno generation: ${record.canonical.generation_id}`,
      "Canonical audio is an unchanged checksum-verified local MP3.",
      "The exact Suno title is repeated in both required title slots; no Georgian translation is claimed.",
      "lyrics-en.txt is the existing non-Georgian fallback slot and preserves the source-language lyrics.",
      "Composer, lyricist/poet, translator and rights use the confirmed project defaults and verified per-song attribution.",
      `Recording and publication rights: CONFIRMED — ${preparation.project_metadata.rights_holder}.`,
      `Archive ownership: CONFIRMED — ${preparation.project_metadata.archive_owner}.`,
      "Final MP3 approval and Learning mode are CONFIRMED for this canonical package.",
      "This preparation is draft-only and does not authorize import or publication.",
      "No temporary, signed, protected or expiring Suno media URL is stored.",
    ].join("\n");
    await Promise.all([
      writeFile(path.join(folder, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
      writeFile(path.join(folder, "suno-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8"),
      writeFile(path.join(folder, "lyrics-en.txt"), lyrics, "utf8"),
      writeFile(path.join(folder, "UPLOAD_NOTES.txt"), `${notes}\n`, "utf8"),
    ]);
    await writeChecksums(folder, ["audio.mp3", "lyrics-en.txt", "metadata.json", "suno-provenance.json", "UPLOAD_NOTES.txt"]);
    packages.push({ slug: record.slug, path: folder, audioSha256: actualSha256 });
  }

  const batch = {
    schema: "zura-song-batch/v1",
    concurrency: 2,
    packages: packages.map((entry) => ({ path: path.relative(options.output, entry.path).replace(/\\/g, "/"), expectedSlug: entry.slug })),
  };
  const batchPath = path.join(options.output, "phase6-batch.json");
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  return { batchPath, packages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audioRoot = argument("audio-root");
  const lyricsSource = argument("lyrics-source");
  const output = argument("output") ?? path.resolve("tmp/phase6-suno-import");
  if (!audioRoot || !lyricsSource) {
    console.error("Usage: pnpm prepare:phase6 -- --audio-root=<folder> --lyrics-source=<file> [--output=<folder>]");
    process.exitCode = 2;
  } else {
    preparePhase6Packages({ audioRoot, lyricsSource, output })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
  }
}
