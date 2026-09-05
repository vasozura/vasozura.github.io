-- Phase 5: additive catalog indexes and transactional importer finalization.
-- This migration does not update or delete any song, file, manifest, or Storage object.

create extension if not exists pg_trgm;

create index if not exists songs_catalog_page_idx
  on public.songs (published_at desc nulls last, id)
  where status = 'published';

create index if not exists songs_catalog_search_idx
  on public.songs using gin (
    lower(coalesce(title_ka,'') || ' ' || coalesce(title_en,'') || ' ' || coalesce(display_credit,'') || ' ' || coalesce(composer,'') || ' ' || coalesce(lyricist,'')) gin_trgm_ops
  ) where status = 'published';

create table if not exists public.archive_import_batches (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null check (schema_version = 'zura-song-batch/v1'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  manifest_checksum text not null check (manifest_checksum ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('validating','ready','importing','incomplete','complete','failed')),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, manifest_checksum)
);

create table if not exists public.archive_import_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.archive_import_batches(id) on delete cascade,
  song_slug text not null check (song_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  song_id uuid references public.songs(id) on delete set null,
  status text not null check (status in ('validated','staging','ready','incomplete','complete','failed')),
  checkpoint jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, song_slug)
);

create index if not exists archive_import_batches_owner_idx
  on public.archive_import_batches (owner_id, created_at desc);
create index if not exists archive_import_jobs_batch_idx
  on public.archive_import_jobs (batch_id, created_at, id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='archive_import_batches_set_updated_at' and not tgisinternal) then
    create trigger archive_import_batches_set_updated_at before update on public.archive_import_batches
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='archive_import_jobs_set_updated_at' and not tgisinternal) then
    create trigger archive_import_jobs_set_updated_at before update on public.archive_import_jobs
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.archive_import_batches enable row level security;
alter table public.archive_import_jobs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='archive_import_batches' and policyname='Admins manage import batches') then
    create policy "Admins manage import batches" on public.archive_import_batches for all to authenticated
      using (public.is_admin() and owner_id = auth.uid())
      with check (public.is_admin() and owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='archive_import_jobs' and policyname='Admins manage import jobs') then
    create policy "Admins manage import jobs" on public.archive_import_jobs for all to authenticated
      using (public.is_admin() and exists (select 1 from public.archive_import_batches b where b.id=batch_id and b.owner_id=auth.uid()))
      with check (public.is_admin() and exists (select 1 from public.archive_import_batches b where b.id=batch_id and b.owner_id=auth.uid()));
  end if;
end $$;

grant select, insert, update, delete on public.archive_import_batches, public.archive_import_jobs to authenticated;
revoke all on public.archive_import_batches, public.archive_import_jobs from anon;

create or replace function public.finalize_song_import(
  p_song_id uuid,
  p_song jsonb,
  p_files jsonb default '[]'::jsonb,
  p_parts jsonb default '[]'::jsonb,
  p_resume boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, storage, auth, pg_temp
as $$
declare
  v_slug text := trim(p_song->>'slug');
  v_existing public.songs%rowtype;
  v_file jsonb;
  v_part jsonb;
  v_bucket text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'archive owner authorization required';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid song slug'; end if;
  if coalesce(p_song->>'status', 'draft') <> 'draft' then raise exception 'imports must remain draft'; end if;
  if nullif(trim(p_song->>'title_ka'), '') is null or nullif(trim(p_song->>'title_en'), '') is null then raise exception 'both titles are required'; end if;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_parts, '[]'::jsonb)) <> 'array' then raise exception 'files and parts must be arrays'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_slug, 0));
  select * into v_existing from public.songs where slug = v_slug for update;
  if found and v_existing.status = 'published' then raise exception 'published songs cannot be overwritten'; end if;
  if found and v_existing.id <> p_song_id then raise exception 'slug belongs to another song'; end if;
  if found and not p_resume then raise exception 'existing draft requires explicit resume'; end if;

  insert into public.songs (
    id, slug, status, title_ka, title_en, display_credit, composer, lyricist, translator,
    language, description_ka, description_en, lyrics_ka, lyrics_en, cover_url, audio_url,
    midi_url, musicxml_url, score_pdf_url, source_project_url, suno_url, youtube_url,
    youtube_video_id, duration_seconds, bpm, musical_key, time_signature, difficulty,
    learning_enabled, learning_instruments, learning_source_type, learning_source_checksum,
    learning_mapping, learning_fingering, published_at
  ) values (
    p_song_id, v_slug, 'draft', p_song->>'title_ka', p_song->>'title_en', p_song->>'display_credit',
    p_song->>'composer', p_song->>'lyricist', p_song->>'translator', p_song->>'language',
    p_song->>'description_ka', p_song->>'description_en', p_song->>'lyrics_ka', p_song->>'lyrics_en',
    p_song->>'cover_url', p_song->>'audio_url', p_song->>'midi_url', p_song->>'musicxml_url',
    p_song->>'score_pdf_url', p_song->>'source_project_url', p_song->>'suno_url', p_song->>'youtube_url',
    p_song->>'youtube_video_id', nullif(p_song->>'duration_seconds','')::integer,
    nullif(p_song->>'bpm','')::numeric, p_song->>'musical_key', p_song->>'time_signature',
    nullif(p_song->>'difficulty','')::public.song_difficulty,
    coalesce((p_song->>'learning_enabled')::boolean, false),
    array(select jsonb_array_elements_text(coalesce(p_song->'learning_instruments','[]'::jsonb))),
    coalesce(p_song->>'learning_source_type','musicxml'), p_song->>'learning_source_checksum',
    coalesce(p_song->'learning_mapping','{}'::jsonb), coalesce(p_song->'learning_fingering','{}'::jsonb), null
  )
  on conflict (id) do update set
    title_ka=excluded.title_ka, title_en=excluded.title_en, display_credit=excluded.display_credit,
    composer=excluded.composer, lyricist=excluded.lyricist, translator=excluded.translator,
    language=excluded.language, description_ka=excluded.description_ka, description_en=excluded.description_en,
    lyrics_ka=excluded.lyrics_ka, lyrics_en=excluded.lyrics_en, cover_url=coalesce(excluded.cover_url, songs.cover_url),
    audio_url=coalesce(excluded.audio_url, songs.audio_url), midi_url=coalesce(excluded.midi_url, songs.midi_url),
    musicxml_url=coalesce(excluded.musicxml_url, songs.musicxml_url), score_pdf_url=coalesce(excluded.score_pdf_url, songs.score_pdf_url),
    source_project_url=coalesce(excluded.source_project_url, songs.source_project_url), suno_url=excluded.suno_url,
    youtube_url=excluded.youtube_url, youtube_video_id=excluded.youtube_video_id, duration_seconds=excluded.duration_seconds,
    bpm=excluded.bpm, musical_key=excluded.musical_key, time_signature=excluded.time_signature,
    difficulty=excluded.difficulty, learning_enabled=excluded.learning_enabled,
    learning_instruments=excluded.learning_instruments, learning_source_type=excluded.learning_source_type,
    learning_source_checksum=excluded.learning_source_checksum, learning_mapping=excluded.learning_mapping,
    learning_fingering=excluded.learning_fingering, status='draft', published_at=null;

  for v_file in select value from jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) loop
    v_bucket := case v_file->>'file_type'
      when 'cover' then 'covers' when 'audio' then 'audio' when 'midi' then 'midi'
      when 'musicxml' then 'musicxml' when 'score_pdf' then 'scores' when 'lyrics' then 'lyrics'
      when 'source_project' then 'instrument-parts' when 'instrument_part' then 'instrument-parts'
      else null end;
    if v_bucket is null then raise exception 'unsupported file type'; end if;
    if coalesce(v_file->>'checksum','') !~ '^[a-f0-9]{64}$'
       or split_part(regexp_replace(v_file->>'storage_path','^.*/',''),'-',1) <> left(v_file->>'checksum',12)
       or not exists (
         select 1 from storage.objects
         where bucket_id=v_bucket
           and name=v_file->>'storage_path'
           and coalesce((metadata->>'size')::bigint,-1)=(v_file->>'file_size')::bigint
       ) then raise exception 'staged Storage object is missing or does not match checksum path and size'; end if;
    insert into public.song_files(song_id,file_type,storage_path,public_url,original_filename,mime_type,file_size,checksum,version)
    values(p_song_id,(v_file->>'file_type')::public.song_file_type,v_file->>'storage_path',v_file->>'public_url',v_file->>'original_filename',v_file->>'mime_type',(v_file->>'file_size')::bigint,v_file->>'checksum',(v_file->>'version')::integer)
    on conflict (song_id,checksum) do nothing;
  end loop;

  for v_part in select value from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb)) loop
    insert into public.instrument_parts(song_id,instrument,musicxml_url,midi_url,fingering_json,difficulty,notes)
    values(p_song_id,(v_part->>'instrument')::public.instrument_name,v_part->>'musicxml_url',v_part->>'midi_url',coalesce(v_part->'fingering_json','{}'::jsonb),nullif(v_part->>'difficulty','')::public.song_difficulty,v_part->>'notes')
    on conflict (song_id,instrument) do update set
      musicxml_url=coalesce(excluded.musicxml_url,instrument_parts.musicxml_url),
      midi_url=coalesce(excluded.midi_url,instrument_parts.midi_url),
      fingering_json=excluded.fingering_json, difficulty=excluded.difficulty, notes=excluded.notes;
  end loop;
  return p_song_id;
end;
$$;

revoke all on function public.finalize_song_import(uuid,jsonb,jsonb,jsonb,boolean) from public, anon;
grant execute on function public.finalize_song_import(uuid,jsonb,jsonb,jsonb,boolean) to authenticated, service_role;
