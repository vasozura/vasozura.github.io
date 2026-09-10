-- Karaoke artifact delivery.
--
-- Prepared Karaoke artifacts (manifest, subtitles, MIDI, optional rendered video) are derived
-- entirely from a song that is already public: its canonical MP3 page, its authoritative lyrics and
-- deterministic analysis of them. They carry no credential and no unpublished material.
--
-- The browser fetches `manifest.json` with a plain fetch and resolves every artifact inside it as a
-- path relative to that manifest, so the delivery URL has to be stable and unsigned. A private
-- bucket cannot provide that: a signed URL expires, and a relative path resolved against one loses
-- its token. This bucket is therefore public for reads, and the upload script refuses to publish
-- artifacts for a song that is not itself published, so nothing reaches it ahead of the song.
-- Writes stay admin-only, exactly like every other archive bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('karaoke', 'karaoke', true, 104857600, array['application/json','text/plain','audio/midi','audio/x-midi','audio/mpeg','video/mp4','application/octet-stream'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Karaoke artifacts are readable" on storage.objects for select to anon, authenticated using (bucket_id = 'karaoke');
create policy "Admins upload karaoke artifacts" on storage.objects for insert to authenticated with check (bucket_id = 'karaoke' and public.is_admin());
create policy "Admins update karaoke artifacts" on storage.objects for update to authenticated using (bucket_id = 'karaoke' and public.is_admin()) with check (bucket_id = 'karaoke' and public.is_admin());
create policy "Admins delete karaoke artifacts" on storage.objects for delete to authenticated using (bucket_id = 'karaoke' and public.is_admin());

-- `learning_mapping.karaokeManifestUrl` is the one reference the song page reads. It already exists
-- as a jsonb key on public.songs; this comment records what belongs in it.
comment on column public.songs.learning_mapping is
  'Learning configuration. Reserved keys: part/hand mapping per part id, and karaokeManifestUrl - the absolute public URL of the prepared Karaoke manifest.json, written by scripts/publish-karaoke-artifacts.ts.';
