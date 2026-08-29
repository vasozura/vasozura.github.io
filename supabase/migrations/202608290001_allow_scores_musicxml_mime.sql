-- Allow the private Learning API staging bucket to accept canonical MusicXML.
-- Preserve every existing MIME type and make repeated application a no-op.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type order by mime_type)
  from unnest(
    coalesce(allowed_mime_types, array[]::text[])
    || array[
      'application/xml',
      'text/xml',
      'application/vnd.recordare.musicxml+xml',
      'application/vnd.recordare.musicxml',
      'application/x-musicxml+xml'
    ]::text[]
  ) as mime_type
)
where id = 'scores';
