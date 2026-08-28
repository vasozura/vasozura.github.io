# Supabase setup

The application is fully usable with the three local demo releases until a Supabase project is connected. No credential is stored in the repository.

## 1. Create and migrate the project

1. Create a Supabase project in the owner's account.
2. Open **SQL Editor** and run, in filename order:
   - `supabase/migrations/202608260001_composer_archive.sql`
   - `supabase/migrations/202608260002_seed_verified_songs.sql`
   - `supabase/migrations/202608270001_grant_archive_owner.sql`
   - `supabase/migrations/202608270002_allow_windows_midi_mime.sql`
3. Alternatively, after installing and authenticating the Supabase CLI, run:

   ```powershell
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

The first migration creates tables, indexes, updated-at triggers, RLS policies, RPC authorization, and Storage buckets. The second migration inserts only the three verified Phase 1 releases. The third migration grants this archive's existing Auth user owner access. The fourth adds Windows browser compatibility for the `audio/mid` MIDI MIME type.

## 2. Create the owner identity

1. In **Authentication → Users**, create/invite the owner's email account before applying the owner migration.
2. For another deployment, replace the project-specific UUID in the owner migration before it is first applied.
3. If the migration has already been applied and the owner changes, use SQL Editor to upsert the replacement UUID:

   ```sql
   insert into public.admin_profiles (id, display_name)
   values ('OWNER_AUTH_USER_UUID', 'Archive owner')
   on conflict (id) do update set display_name = excluded.display_name;
   ```

The bootstrap insert is intentionally not available to browser clients. After it exists, `public.is_admin()` and RLS authorize that owner.

## 3. Configure the browser app

Copy `.env.example` to `.env.local` and set only the browser-safe public values:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Never put a service-role key in a variable prefixed with `VITE_`. Vite includes `VITE_*` values in browser bundles.

For GitHub Pages, define those two values as repository Actions variables or secrets and expose them to the build step before deploying Part B. Part B must not be merged/deployed until reviewed.

## 4. Storage structure

All object names begin with the song slug, allowing storage RLS to match an object to its published song:

```text
covers/<song-slug>/<versioned-file>
audio/<song-slug>/<versioned-file>
midi/<song-slug>/<versioned-file>
musicxml/<song-slug>/<versioned-file>
scores/<song-slug>/<versioned-file>
lyrics/<song-slug>/<versioned-file>
instrument-parts/<song-slug>/<versioned-file>
```

Buckets are private. After RLS confirms that a visitor may read a published song's `song_files` row and Storage object, the app creates a one-hour signed URL. Draft object paths cannot be signed anonymously. Administrative writes require an authenticated `admin_profiles` row.

## Security checks

- RLS is enabled on every application table.
- Anonymous users can select only published songs and public playlists.
- The anonymous key is not an administration bypass; owner writes pass through authentication and RLS.
- The service-role key is accepted only by the local importer process.
- File limits are enforced in UI/importer validation, database checks, and Storage bucket configuration.
- Confirmed song deletion removes recorded physical Storage objects before deleting relational records, preventing orphaned archive files. A Storage failure aborts the database deletion.
