-- Restore the owner-only RPC used by the administration dashboard.
-- Publication and Learning exercise visibility change in the same transaction.

create or replace function public.set_song_publication_with_learning(
  p_song_id uuid,
  p_status public.song_status
)
returns table (song_status public.song_status, published_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_song public.songs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'archive owner authorization required';
  end if;

  select * into v_song
  from public.songs
  where id = p_song_id
  for update;

  if not found then
    raise exception 'song not found';
  end if;

  if p_status = 'published' and v_song.learning_enabled then
    if coalesce(array_length(v_song.learning_instruments, 1), 0) = 0 then
      raise exception 'learning mode needs at least one instrument before publishing';
    end if;

    if v_song.learning_source_type = 'midi' and v_song.midi_url is null then
      raise exception 'the selected learning source requires a MIDI file';
    elsif coalesce(v_song.learning_source_type, 'musicxml') = 'musicxml' and v_song.musicxml_url is null then
      raise exception 'the selected learning source requires a MusicXML/MXL file';
    end if;

    if v_song.learning_source_checksum is null
       or v_song.learning_source_checksum !~ '^[a-f0-9]{64}$'
       or v_song.learning_manifest_version is null
       or v_song.learning_manifest is null then
      raise exception 'learning manifest is missing or incomplete';
    end if;
  end if;

  update public.songs
  set status = p_status,
      published_at = case
        when p_status = 'published' then coalesce(v_song.published_at, now())
        else null
      end
  where id = p_song_id
  returning status, songs.published_at
  into song_status, published_at;

  update public.learning_exercises
  set is_public = (p_status = 'published')
  where song_id = p_song_id;

  return next;
end;
$$;

revoke all on function public.set_song_publication_with_learning(uuid, public.song_status) from public, anon;
grant execute on function public.set_song_publication_with_learning(uuid, public.song_status) to authenticated;

