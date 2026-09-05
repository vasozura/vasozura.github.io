import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../supabase/migrations/202609050001_phase5_catalog_import.sql", import.meta.url);

describe("Phase 5 catalog/import migration", () => {
  it("is additive, idempotent and draft-only", async () => {
    const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();
    expect(sql).not.toMatch(/\b(drop|truncate|delete\s+from|alter\s+type|update\s+public\.songs)\b/);
    expect(sql).toContain("create table if not exists public.archive_import_batches");
    expect(sql).toContain("create table if not exists public.archive_import_jobs");
    expect(sql).toContain("create index if not exists songs_catalog_page_idx");
    expect(sql).toContain("create or replace function public.finalize_song_import");
    expect(sql).toContain("imports must remain draft");
    expect(sql).toContain("published songs cannot be overwritten");
    expect(sql).toContain("staged storage object is missing");
  });

  it("keeps import state owner-only and revokes public function access", async () => {
    const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();
    expect(sql).toContain("alter table public.archive_import_batches enable row level security");
    expect(sql).toContain("alter table public.archive_import_jobs enable row level security");
    expect(sql).toContain("public.is_admin() and owner_id = auth.uid()");
    expect(sql).toContain("revoke all on function public.finalize_song_import");
  });
});
