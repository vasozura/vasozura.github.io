import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runImport, type ImportReport } from "./import-song";

export interface BatchEntry { path: string; expectedSlug: string; }
export interface BatchManifest { schema: "zura-song-batch/v1"; packages: BatchEntry[]; }
export interface BatchReport { dryRun: boolean; valid: boolean; reports: ImportReport[]; issues: string[]; }

export async function inspectBatchManifest(filename: string): Promise<{ manifest: BatchManifest | null; issues: string[] }> {
  let value: unknown;
  try { value = JSON.parse(await readFile(filename, "utf8")); }
  catch (error) { return { manifest: null, issues: [error instanceof Error ? error.message : "Batch manifest is invalid."] }; }
  if (!value || typeof value !== "object") return { manifest: null, issues: ["Batch manifest must be an object."] };
  const candidate = value as Partial<BatchManifest>;
  if (candidate.schema !== "zura-song-batch/v1") return { manifest: null, issues: ["Unsupported batch schema."] };
  if (!Array.isArray(candidate.packages) || candidate.packages.length === 0) return { manifest: null, issues: ["Batch must contain at least one package."] };
  const issues: string[] = [];
  candidate.packages.forEach((entry, index) => {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) issues.push(`packages[${index}].path is required.`);
    if (!entry || typeof entry.expectedSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.expectedSlug)) issues.push(`packages[${index}].expectedSlug is invalid.`);
  });
  return { manifest: issues.length ? null : candidate as BatchManifest, issues };
}

export async function runBatch(filename: string, dryRun: boolean): Promise<BatchReport> {
  const inspected = await inspectBatchManifest(filename);
  const result: BatchReport = { dryRun, valid: inspected.issues.length === 0, reports: [], issues: [...inspected.issues] };
  if (!inspected.manifest) return result;
  const base = path.dirname(path.resolve(filename));
  for (const entry of inspected.manifest.packages) {
    const report = await runImport(path.resolve(base, entry.path), dryRun);
    result.reports.push(report);
    if (report.slug !== entry.expectedSlug) {
      result.valid = false;
      result.issues.push(`Expected slug ${entry.expectedSlug}, found ${report.slug}.`);
      break;
    }
    if (!report.valid) { result.valid = false; break; }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const filename = args.find((argument) => !argument.startsWith("--"));
  if (!filename) { console.error("Usage: pnpm import:batch -- <batch.json> [--dry-run]"); process.exitCode = 2; }
  else runBatch(filename, args.includes("--dry-run")).then((report) => { console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
