import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runImport, type ImportOptions, type ImportReport } from "./import-song";

export interface BatchEntry { path: string; expectedSlug: string; resume?: boolean; }
export interface BatchManifest { schema: "zura-song-batch/v1"; concurrency?: number; packages: BatchEntry[]; }
export interface BatchCheckpoint { schema: "zura-song-batch-checkpoint/v1"; manifestChecksum: string; completedSlugs: string[]; }
export interface BatchReport {
  dryRun: boolean;
  valid: boolean;
  manifestChecksum: string | null;
  reports: ImportReport[];
  issues: string[];
  aggregate: { total: number; valid: number; failed: number; uploaded: number; reused: number; compensated: number };
}

export async function inspectBatchManifest(filename: string): Promise<{ manifest: BatchManifest | null; issues: string[]; checksum: string | null }> {
  let raw: string;
  let value: unknown;
  try { raw = await readFile(filename, "utf8"); value = JSON.parse(raw); }
  catch (error) { return { manifest: null, issues: [error instanceof Error ? error.message : "Batch manifest is invalid."], checksum: null }; }
  const checksum = createHash("sha256").update(raw).digest("hex");
  if (!value || typeof value !== "object") return { manifest: null, issues: ["Batch manifest must be an object."], checksum };
  const candidate = value as Partial<BatchManifest>;
  if (candidate.schema !== "zura-song-batch/v1") return { manifest: null, issues: ["Unsupported batch schema."], checksum };
  if (!Array.isArray(candidate.packages) || candidate.packages.length === 0) return { manifest: null, issues: ["Batch must contain at least one package."], checksum };
  const issues: string[] = [];
  if (candidate.concurrency !== undefined && (!Number.isInteger(candidate.concurrency) || candidate.concurrency < 1 || candidate.concurrency > 4)) issues.push("Batch concurrency must be between 1 and 4.");
  candidate.packages.forEach((entry, index) => {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) issues.push(`packages[${index}].path is required.`);
    if (!entry || typeof entry.expectedSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.expectedSlug)) issues.push(`packages[${index}].expectedSlug is invalid.`);
    if (entry?.resume !== undefined && typeof entry.resume !== "boolean") issues.push(`packages[${index}].resume must be boolean.`);
  });
  const slugs = candidate.packages.map((entry) => entry.expectedSlug);
  const paths = candidate.packages.map((entry) => entry.path.toLocaleLowerCase());
  if (new Set(slugs).size !== slugs.length) issues.push("Batch contains duplicate expected slugs.");
  if (new Set(paths).size !== paths.length) issues.push("Batch contains duplicate package paths.");
  return { manifest: issues.length ? null : candidate as BatchManifest, issues, checksum };
}

async function readCheckpoint(filename: string | undefined, checksum: string): Promise<BatchCheckpoint> {
  if (!filename) return { schema: "zura-song-batch-checkpoint/v1", manifestChecksum: checksum, completedSlugs: [] };
  try {
    const parsed = JSON.parse(await readFile(filename, "utf8")) as BatchCheckpoint;
    if (parsed.schema !== "zura-song-batch-checkpoint/v1" || parsed.manifestChecksum !== checksum || !Array.isArray(parsed.completedSlugs)) throw new Error("checkpoint mismatch");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: "zura-song-batch-checkpoint/v1", manifestChecksum: checksum, completedSlugs: [] };
    throw new Error("Checkpoint does not match this batch manifest.");
  }
}

function updateAggregate(report: BatchReport): void {
  report.aggregate = {
    total: report.reports.length,
    valid: report.reports.filter((entry) => entry.valid).length,
    failed: report.reports.filter((entry) => !entry.valid).length,
    uploaded: report.reports.reduce((sum, entry) => sum + entry.uploaded.length, 0),
    reused: report.reports.reduce((sum, entry) => sum + entry.reused.length, 0),
    compensated: report.reports.reduce((sum, entry) => sum + entry.compensated.length, 0),
  };
}

export async function runBatch(
  filename: string,
  dryRun: boolean,
  options: ImportOptions & { checkpointPath?: string; concurrency?: number } = {},
): Promise<BatchReport> {
  const inspected = await inspectBatchManifest(filename);
  const result: BatchReport = { dryRun, valid: inspected.issues.length === 0, manifestChecksum: inspected.checksum, reports: [], issues: [...inspected.issues], aggregate: { total: 0, valid: 0, failed: 0, uploaded: 0, reused: 0, compensated: 0 } };
  if (!inspected.manifest || !inspected.checksum) return result;
  const manifestChecksum = inspected.checksum;
  const base = path.dirname(path.resolve(filename));

  const preflight = await Promise.all(inspected.manifest.packages.map(async (entry) => ({ entry, report: await runImport(path.resolve(base, entry.path), true) })));
  for (const { entry, report } of preflight) {
    result.reports.push(report);
    if (report.slug !== entry.expectedSlug) { result.valid = false; result.issues.push(`Expected slug ${entry.expectedSlug}, found ${report.slug}.`); }
    if (!report.valid) result.valid = false;
  }
  const checksumOwners = new Map<string, { slug: string; file: string }>();
  for (const report of result.reports) {
    for (const entry of report.checksums) {
      const owner = checksumOwners.get(entry.checksum);
      if (owner && owner.slug !== report.slug) {
        result.valid = false;
        result.issues.push(`Duplicate checksum across ${owner.slug}/${owner.file} and ${report.slug}/${entry.file}.`);
      } else {
        checksumOwners.set(entry.checksum, { slug: report.slug, file: entry.file });
      }
    }
  }
  updateAggregate(result);
  if (dryRun || !result.valid) return result;

  const checkpoint = await readCheckpoint(options.checkpointPath, manifestChecksum);
  result.reports = [];
  const queue = inspected.manifest.packages.filter((entry) => !checkpoint.completedSlugs.includes(entry.expectedSlug));
  const completed = new Set(checkpoint.completedSlugs);
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? inspected.manifest.concurrency ?? 2));
  let cursor = 0;
  let checkpointWrite = Promise.resolve();
  const persistCheckpoint = (): Promise<void> => {
    if (!options.checkpointPath) return Promise.resolve();
    const body = `${JSON.stringify({ schema: "zura-song-batch-checkpoint/v1", manifestChecksum, completedSlugs: [...completed].sort() } satisfies BatchCheckpoint, null, 2)}\n`;
    checkpointWrite = checkpointWrite.then(() => writeFile(options.checkpointPath!, body, { encoding: "utf8", mode: 0o600 }));
    return checkpointWrite;
  };
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (cursor < queue.length) {
      const entry = queue[cursor++];
      const report = await runImport(path.resolve(base, entry.path), false, { ...options, resume: entry.resume === true });
      result.reports.push(report);
      if (report.valid) {
        completed.add(entry.expectedSlug);
        await persistCheckpoint();
      }
    }
  });
  await Promise.all(workers);
  const order = new Map(inspected.manifest.packages.map((entry, index) => [entry.expectedSlug, index]));
  result.reports.sort((left, right) => (order.get(left.slug) ?? 0) - (order.get(right.slug) ?? 0));
  result.valid = result.reports.every((report) => report.valid);
  updateAggregate(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const filename = args.find((argument) => !argument.startsWith("--"));
  const checkpointArg = args.find((argument) => argument.startsWith("--checkpoint="));
  const concurrencyArg = args.find((argument) => argument.startsWith("--concurrency="));
  if (!filename) { console.error("Usage: pnpm import:batch -- <batch.json> [--dry-run] [--checkpoint=path] [--concurrency=1..4]"); process.exitCode = 2; }
  else runBatch(filename, args.includes("--dry-run"), { checkpointPath: checkpointArg?.slice("--checkpoint=".length), concurrency: concurrencyArg ? Number(concurrencyArg.slice("--concurrency=".length)) : undefined }).then((report) => { console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
