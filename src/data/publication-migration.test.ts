import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../supabase/migrations/202611110001_restore_atomic_song_publication.sql", import.meta.url);

describe("atomic song publication migration", () => {
  it("restores the RPC called by the owner dashboard", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("create or replace function public.set_song_publication_with_learning");
    expect(sql).toContain("if not public.is_admin()");
    expect(sql).toContain("for update");
    expect(sql).toContain("set status = p_status");
    expect(sql).toContain("set is_public = (p_status = 'published')");
  });

  it("keeps anonymous callers out and validates enabled Learning releases", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("learning manifest is missing or incomplete");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });
});
