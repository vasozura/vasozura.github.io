insert into public.songs (id, slug, status, title_ka, title_en, display_credit, youtube_url, youtube_video_id)
values
  ('00000000-0000-4000-8000-000000000001', 'ra-mogdis-kalav', 'published', 'რა მოგდის ქალავ', 'Ra Mogdis Kalav', 'ბერდია ბერიაშვილი', 'https://youtu.be/CyVj82pN18o', 'CyVj82pN18o'),
  ('00000000-0000-4000-8000-000000000002', 'broken-string', 'published', 'გაწყვეტილი ლარი', 'Broken String', 'მირზა გელოვანი', 'https://youtu.be/cGEGZxQW34g', 'cGEGZxQW34g'),
  ('00000000-0000-4000-8000-000000000003', 'two-words', 'published', 'ორი სიტყვა', 'Two Words', 'ZURA', 'https://youtu.be/ZAFk4sxfsic', 'ZAFk4sxfsic')
on conflict (slug) do update set
  title_ka = excluded.title_ka,
  title_en = excluded.title_en,
  display_credit = excluded.display_credit,
  youtube_url = excluded.youtube_url,
  youtube_video_id = excluded.youtube_video_id,
  status = 'published';
