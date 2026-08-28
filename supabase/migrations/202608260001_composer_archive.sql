create extension if not exists pgcrypto;

create type public.song_status as enum ('draft', 'published');
create type public.song_difficulty as enum ('beginner', 'intermediate', 'advanced');
create type public.song_file_type as enum ('cover', 'audio', 'midi', 'musicxml', 'score_pdf', 'source_project', 'lyrics', 'instrument_part');
create type public.instrument_name as enum ('piano', 'guitar', 'accordion');

create table public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.song_status not null default 'draft',
  title_ka text not null check (length(trim(title_ka)) > 0),
  title_en text not null check (length(trim(title_en)) > 0),
  display_credit text,
  composer text,
  lyricist text,
  translator text,
  language text,
  description_ka text,
  description_en text,
  lyrics_ka text,
  lyrics_en text,
  cover_url text,
  audio_url text,
  midi_url text,
  musicxml_url text,
  score_pdf_url text,
  source_project_url text,
  suno_url text,
  youtube_url text,
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  bpm numeric(6,2) check (bpm is null or bpm between 1 and 400),
  musical_key text,
  time_signature text,
  difficulty public.song_difficulty,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.song_files (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  file_type public.song_file_type not null,
  storage_path text not null unique,
  public_url text not null,
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 104857600),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (song_id, checksum)
);

create table public.instrument_parts (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  instrument public.instrument_name not null,
  musicxml_url text,
  midi_url text,
  fingering_json jsonb,
  difficulty public.song_difficulty,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (song_id, instrument)
);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_ka text not null,
  title_en text not null,
  description_ka text,
  description_en text,
  is_public boolean not null default false,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (playlist_id, song_id),
  unique (playlist_id, position)
);

create index songs_publication_idx on public.songs (status, published_at desc nulls last);
create index songs_language_idx on public.songs (language) where status = 'published';
create index songs_lyricist_idx on public.songs (lyricist) where status = 'published';
create index songs_difficulty_idx on public.songs (difficulty) where status = 'published';
create index song_files_song_type_idx on public.song_files (song_id, file_type, version desc);
create index instrument_parts_song_idx on public.instrument_parts (song_id);
create index playlist_items_order_idx on public.playlist_items (playlist_id, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger songs_set_updated_at before update on public.songs for each row execute function public.set_updated_at();
create trigger instrument_parts_set_updated_at before update on public.instrument_parts for each row execute function public.set_updated_at();
create trigger playlists_set_updated_at before update on public.playlists for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admin_profiles enable row level security;
alter table public.songs enable row level security;
alter table public.song_files enable row level security;
alter table public.instrument_parts enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;

create policy "Admins can read profiles" on public.admin_profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "Admins manage profiles" on public.admin_profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Published songs are public" on public.songs for select to anon, authenticated using (status = 'published' or public.is_admin());
create policy "Admins insert songs" on public.songs for insert to authenticated with check (public.is_admin());
create policy "Admins update songs" on public.songs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete songs" on public.songs for delete to authenticated using (public.is_admin());

create policy "Published song files are public" on public.song_files for select to anon, authenticated using (public.is_admin() or exists (select 1 from public.songs where songs.id = song_files.song_id and songs.status = 'published'));
create policy "Admins manage song files" on public.song_files for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Published instrument parts are public" on public.instrument_parts for select to anon, authenticated using (public.is_admin() or exists (select 1 from public.songs where songs.id = instrument_parts.song_id and songs.status = 'published'));
create policy "Admins manage instrument parts" on public.instrument_parts for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Public playlists are readable" on public.playlists for select to anon, authenticated using (is_public or public.is_admin());
create policy "Admins manage playlists" on public.playlists for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Public playlist items are readable" on public.playlist_items for select to anon, authenticated using (public.is_admin() or (exists (select 1 from public.playlists where playlists.id = playlist_items.playlist_id and playlists.is_public) and exists (select 1 from public.songs where songs.id = playlist_items.song_id and songs.status = 'published')));
create policy "Admins manage playlist items" on public.playlist_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.songs, public.song_files, public.instrument_parts, public.playlists, public.playlist_items to anon, authenticated;
grant select, insert, update, delete on public.admin_profiles, public.songs, public.song_files, public.instrument_parts, public.playlists, public.playlist_items to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('covers', 'covers', false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('audio', 'audio', false, 104857600, array['audio/mpeg','audio/mp3']),
  ('midi', 'midi', false, 5242880, array['audio/midi','audio/x-midi','application/octet-stream']),
  ('musicxml', 'musicxml', false, 20971520, array['application/vnd.recordare.musicxml+xml','application/vnd.recordare.musicxml','application/xml','text/xml','application/zip','application/octet-stream']),
  ('scores', 'scores', false, 26214400, array['application/pdf']),
  ('lyrics', 'lyrics', false, 1048576, array['text/plain']),
  ('instrument-parts', 'instrument-parts', false, 52428800, array['application/x-musescore','application/vnd.recordare.musicxml+xml','application/vnd.recordare.musicxml','application/xml','text/xml','application/zip','audio/midi','audio/x-midi','application/json','application/octet-stream'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Published archive objects are public" on storage.objects for select to anon, authenticated using (
  bucket_id in ('covers','audio','midi','musicxml','scores','lyrics','instrument-parts')
  and (public.is_admin() or exists (select 1 from public.songs where songs.slug = split_part(storage.objects.name, '/', 1) and songs.status = 'published'))
);
create policy "Admins upload archive objects" on storage.objects for insert to authenticated with check (bucket_id in ('covers','audio','midi','musicxml','scores','lyrics','instrument-parts') and public.is_admin());
create policy "Admins update archive objects" on storage.objects for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete archive objects" on storage.objects for delete to authenticated using (public.is_admin());
