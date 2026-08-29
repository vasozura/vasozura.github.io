import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase security migration", () => {
  it("enables RLS and separates public reads from admin writes", async () => {
    const sql = await readFile(new URL("../../supabase/migrations/202608260001_composer_archive.sql", import.meta.url), "utf8");
    for (const table of ["admin_profiles", "songs", "song_files", "instrument_parts", "playlists", "playlist_items"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain("Admins insert songs");
    expect(sql).toContain("public.is_admin()");
    expect(sql).toContain("('covers', 'covers', false");
    expect(sql).toContain("Published archive objects are public");
    expect(sql).not.toContain("service_role");
  });

  it("keeps learning progress private and published exercises read-only for anonymous users", async () => {
    const sql = await readFile(new URL("../../supabase/migrations/202608280001_phase3_learning.sql", import.meta.url), "utf8");
    for (const table of ["learning_exercises", "learning_attempts", "learning_progress"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain("Published exercises are public");
    expect(sql).toContain("songs.status='published'");
    expect(sql).toContain("auth.uid()=user_id");
    expect(sql).not.toContain("service_role");
  });
});
