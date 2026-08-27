insert into public.admin_profiles (id, display_name)
values ('dba7d95d-4bdf-430b-b035-f6ed261616bc', 'Archive owner')
on conflict (id) do update set display_name = excluded.display_name;
