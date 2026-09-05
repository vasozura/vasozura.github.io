-- Phase 5 follow-up: Supabase projects may have direct default grants for the
-- anon role in addition to PUBLIC grants. Remove only those direct grants.
-- RLS and the owner check already prevent writes; this narrows the exposed
-- privilege surface without changing schema, data, policies, or Storage.

begin;

revoke all on table public.archive_import_batches, public.archive_import_jobs from anon;
revoke all on function public.finalize_song_import(uuid,jsonb,jsonb,jsonb,boolean) from anon;

commit;
