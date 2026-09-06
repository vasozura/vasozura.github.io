import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../supabase/migrations/202609060001_phase6_suno_provenance.sql", import.meta.url);

describe("Phase 6 Suno provenance migration", () => {
  it("is additive and creates normalized provenance without touching Storage", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("create table if not exists public.suno_generations");
    expect(sql).toContain("suno_generations_one_canonical_per_song_idx");
    expect(sql).toContain("generation_id uuid not null unique");
    expect(sql).not.toContain("unique (song_id, generation_id)");
    expect(sql).toMatch(/local_media_filename is null[\s\S]*match_confidence is null[\s\S]*local_media_filename is not null[\s\S]*match_confidence is not null/);
    expect(sql).not.toMatch(/^\s*(drop|truncate|delete\s+from|update\s+public\.)\b/im);
    expect(sql).not.toMatch(/storage\.(buckets|objects)/i);
  });

  it("keeps anonymous reads publication-scoped and mutations owner-only", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("alter table public.suno_generations enable row level security");
    expect(sql).toContain('create policy "Published Suno provenance is public"');
    expect(sql).toContain("songs.status = 'published'");
    expect(sql).toContain('create policy "Admins manage Suno provenance"');
    expect(sql).toContain("using (public.is_admin())");
    expect(sql).toContain("revoke insert, update, delete on public.suno_generations from public, anon");
  });

  it("atomically composes the legacy finalizer with provenance insertion", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("create or replace function public.finalize_song_import_with_suno_provenance");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("perform public.finalize_song_import(p_song_id, p_song, p_files, p_parts, p_resume)");
    expect(sql).toContain("exactly one canonical Suno generation is required");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("Suno generation already belongs to another song");
    expect(sql).toContain("Suno generation relationship cannot change");
    expect(sql).toContain("temporary Suno media URLs are forbidden");
    expect(sql).toContain("revoke all on function public.finalize_song_import_with_suno_provenance");
  });
});
