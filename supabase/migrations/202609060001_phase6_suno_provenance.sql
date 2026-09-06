-- Phase 6: normalized Suno generation provenance for canonical archive imports.
-- Additive only: no existing song, file, policy, bucket, or learning record is changed.

begin;

create table if not exists public.suno_generations (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  generation_id uuid not null unique,
  generation_url text not null,
  title text not null check (length(trim(title)) > 0),
  relationship text not null check (relationship in ('canonical', 'alternate')),
  source_created_at_text text,
  duration_seconds numeric(10,3) not null check (duration_seconds > 0),
  style_prompt text,
  local_media_filename text check (
    local_media_filename is null
    or (
      length(trim(local_media_filename)) > 0
      and local_media_filename !~ '[\\/:]'
    )
  ),
  local_media_sha256 text check (local_media_sha256 is null or local_media_sha256 ~ '^[a-f0-9]{64}$'),
  local_media_duration_seconds numeric(10,3) check (local_media_duration_seconds is null or local_media_duration_seconds > 0),
  match_confidence text check (match_confidence is null or match_confidence in ('exact', 'high', 'review-required', 'unmatched')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (generation_url = 'https://suno.com/song/' || generation_id::text),
  check (
    (
      local_media_filename is null
      and local_media_sha256 is null
      and local_media_duration_seconds is null
      and match_confidence is null
    )
    or (
      local_media_filename is not null
      and local_media_sha256 is not null
      and local_media_duration_seconds is not null
      and match_confidence is not null
    )
  ),
  check (
    relationship <> 'canonical'
    or local_media_filename is not null
  )
);

create unique index if not exists suno_generations_one_canonical_per_song_idx
  on public.suno_generations (song_id)
  where relationship = 'canonical';

create index if not exists suno_generations_song_idx
  on public.suno_generations (song_id, relationship, created_at, id);

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'suno_generations_set_updated_at'
      and tgrelid = 'public.suno_generations'::regclass
      and not tgisinternal
  ) then
    create trigger suno_generations_set_updated_at
      before update on public.suno_generations
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.suno_generations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'suno_generations'
      and policyname = 'Published Suno provenance is public'
  ) then
    create policy "Published Suno provenance is public"
      on public.suno_generations for select to anon, authenticated
      using (
        public.is_admin()
        or exists (
          select 1 from public.songs
          where songs.id = suno_generations.song_id
            and songs.status = 'published'
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'suno_generations'
      and policyname = 'Admins manage Suno provenance'
  ) then
    create policy "Admins manage Suno provenance"
      on public.suno_generations for all to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

grant select on public.suno_generations to anon, authenticated;
grant insert, update, delete on public.suno_generations to authenticated;
grant select, insert, update, delete on public.suno_generations to service_role;
revoke insert, update, delete on public.suno_generations from public, anon;

create or replace function public.finalize_song_import_with_suno_provenance(
  p_song_id uuid,
  p_song jsonb,
  p_files jsonb default '[]'::jsonb,
  p_parts jsonb default '[]'::jsonb,
  p_generations jsonb default '[]'::jsonb,
  p_resume boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_generation jsonb;
  v_generation_id uuid;
  v_existing_song_id uuid;
  v_existing_relationship text;
  v_canonical_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'archive owner authorization required';
  end if;
  if jsonb_typeof(coalesce(p_generations, '[]'::jsonb)) <> 'array' then
    raise exception 'Suno generations must be an array';
  end if;
  select count(*) into v_canonical_count
  from jsonb_array_elements(coalesce(p_generations, '[]'::jsonb)) generation
  where generation->>'relationship' = 'canonical';
  if v_canonical_count <> 1 then
    raise exception 'exactly one canonical Suno generation is required';
  end if;
  if (
    select count(*) <> count(distinct generation->>'generation_id')
    from jsonb_array_elements(coalesce(p_generations, '[]'::jsonb)) generation
  ) then
    raise exception 'Suno generation IDs must be unique';
  end if;

  -- Lock generation identities in stable order so concurrent imports cannot
  -- race the ownership/relationship checks below.
  for v_generation in
    select value
    from jsonb_array_elements(coalesce(p_generations, '[]'::jsonb))
    order by value->>'generation_id'
  loop
    begin
      v_generation_id := (v_generation->>'generation_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid Suno generation ID';
    end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('suno-generation:' || v_generation_id::text, 0)
    );
    if coalesce(v_generation->>'relationship', '') not in ('canonical', 'alternate') then
      raise exception 'invalid Suno generation relationship';
    end if;
    if coalesce(v_generation->>'generation_url', '') <> ('https://suno.com/song/' || v_generation_id::text) then
      raise exception 'Suno generation URL must be the stable public song URL';
    end if;
    if nullif(trim(v_generation->>'title'), '') is null
       or coalesce((v_generation->>'duration_seconds')::numeric, 0) <= 0 then
      raise exception 'Suno title and duration are required';
    end if;
    if v_generation ? 'audio_url' or v_generation ? 'download_url' or v_generation ? 'signed_url' then
      raise exception 'temporary Suno media URLs are forbidden';
    end if;
    if jsonb_typeof(coalesce(v_generation->'evidence', '[]'::jsonb)) <> 'array'
       or exists (
         select 1 from jsonb_array_elements_text(coalesce(v_generation->'evidence', '[]'::jsonb)) evidence_text
         where evidence_text ~* 'https?://'
       ) then
      raise exception 'Suno evidence must be a URL-free JSON array';
    end if;
    if v_generation->>'local_media_filename' ~ '[\\/:]' then
      raise exception 'local media filename must not contain a local path';
    end if;
    if v_generation->>'local_media_sha256' is not null
       and v_generation->>'local_media_sha256' !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid local media SHA-256';
    end if;
    select song_id, relationship into v_existing_song_id, v_existing_relationship
    from public.suno_generations
    where generation_id = v_generation_id;
    if found and v_existing_song_id <> p_song_id then
      raise exception 'Suno generation already belongs to another song';
    end if;
    if found and v_existing_relationship <> v_generation->>'relationship' then
      raise exception 'Suno generation relationship cannot change';
    end if;
  end loop;

  perform public.finalize_song_import(p_song_id, p_song, p_files, p_parts, p_resume);

  for v_generation in select value from jsonb_array_elements(p_generations) loop
    insert into public.suno_generations (
      song_id, generation_id, generation_url, title, relationship,
      source_created_at_text, duration_seconds, style_prompt,
      local_media_filename, local_media_sha256, local_media_duration_seconds,
      match_confidence, evidence
    ) values (
      p_song_id,
      (v_generation->>'generation_id')::uuid,
      v_generation->>'generation_url',
      v_generation->>'title',
      v_generation->>'relationship',
      v_generation->>'source_created_at_text',
      (v_generation->>'duration_seconds')::numeric,
      v_generation->>'style_prompt',
      v_generation->>'local_media_filename',
      v_generation->>'local_media_sha256',
      nullif(v_generation->>'local_media_duration_seconds', '')::numeric,
      nullif(v_generation->>'match_confidence', ''),
      coalesce(v_generation->'evidence', '[]'::jsonb)
    )
    on conflict (generation_id) do update set
      generation_url = excluded.generation_url,
      title = excluded.title,
      source_created_at_text = excluded.source_created_at_text,
      duration_seconds = excluded.duration_seconds,
      style_prompt = excluded.style_prompt,
      local_media_filename = excluded.local_media_filename,
      local_media_sha256 = excluded.local_media_sha256,
      local_media_duration_seconds = excluded.local_media_duration_seconds,
      match_confidence = excluded.match_confidence,
      evidence = excluded.evidence;
  end loop;
  return p_song_id;
end;
$$;

revoke all on function public.finalize_song_import_with_suno_provenance(uuid,jsonb,jsonb,jsonb,jsonb,boolean) from public, anon;
grant execute on function public.finalize_song_import_with_suno_provenance(uuid,jsonb,jsonb,jsonb,jsonb,boolean) to authenticated, service_role;

commit;
