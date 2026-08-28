update storage.buckets
set allowed_mime_types = array['audio/mid','audio/midi','audio/x-midi','application/octet-stream']
where id = 'midi';

update storage.buckets
set allowed_mime_types = array[
  'application/x-musescore',
  'application/vnd.recordare.musicxml+xml',
  'application/vnd.recordare.musicxml',
  'application/xml',
  'text/xml',
  'application/zip',
  'audio/mid',
  'audio/midi',
  'audio/x-midi',
  'application/json',
  'application/octet-stream'
]
where id = 'instrument-parts';
