# MIRACON website and Project Desk

The public MIRACON website and its custom project administration panel live in one Astro application.

## Stack

- Astro in SSR mode with the Vercel adapter
- React for `/admin`
- Supabase PostgreSQL, Auth, and Storage
- A separate Docker media worker using Sharp and FFmpeg
- Existing MIRACON CSS and vanilla JavaScript for the public pages

## Local development

```bash
npm install
npm run dev
```

Without Supabase environment variables, the public site and `/admin` use the local project seed. Admin changes in this mode are intentionally not persisted and uploads are disabled.

## Supabase setup

1. Create a Supabase project in an EU region.
2. Run the SQL files from `supabase/migrations` in filename order in the Supabase SQL editor.
3. Create the administrator under Authentication > Users.
4. Add the new user's UUID to the admin allowlist:

```sql
insert into public.admin_users (user_id)
values ('AUTH_USER_UUID');
```

5. Configure the application environment:

```dotenv
PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=PUBLIC_ANON_KEY
```

The service-role key is not required by the website and must never use the `PUBLIC_` prefix.

The media worker is optional and disabled by default. Its database migration may be applied while the worker remains off; the walkthrough fields depend on the latest migrations, but direct media uploads do not require the worker container. Set `PUBLIC_MEDIA_WORKER_ENABLED=true` only after applying the media migration and deploying the worker.

On the first authenticated visit, an empty database shows an **Import current website projects** action. It imports the five projects bundled in `src/data/projects.ts`.

## Content workflow

- Draft projects are available only to the administrator.
- Published projects appear in the catalog and at `/projects/[slug]`.
- Unpublishing removes the public project without deleting its content.
- Preview is rendered at `/preview/[slug]`, requires the administrator session, has `noindex`, and is sent with `Cache-Control: private, no-store`.
- Project and gallery ordering are stored explicitly and can be changed by drag and drop.
- By default, JPEG/PNG images are resized to at most 2400px and converted to WebP in the administrator browser before direct Storage upload. Videos are uploaded directly.
- Projects can optionally show ordered desktop/mobile walkthrough videos after the gallery and before floor plans. Public playback is muted, control-free, cropped to the frame, and crossfades between clips.
- Image and video hero modes are selectable per project; video heroes support the same ordered desktop/mobile playlist, including immersive presentation and the optional sound control.
- With `PUBLIC_MEDIA_WORKER_ENABLED=true`, originals use the private `media-sources` bucket and responsive AVIF/WebP images plus optimized MP4 videos are generated asynchronously.
- PDF brochures and SVG benefit icons use their public project buckets. They join automatic cleanup only when worker mode is enabled.
- Uploaded image sources are limited to 20 MB, 40 megapixels, and 10,000 px per side. Video sources are MP4 up to 50 MB and are validated again by the worker.
- Unreferenced generated variants are retained for seven days before cleanup. Private originals use the configurable worker source-retention period.

## Optional media worker

Worker mode is off unless `PUBLIC_MEDIA_WORKER_ENABLED=true`. The website uses only the public anon key; the separately deployed worker is the only process that receives `SUPABASE_SERVICE_ROLE_KEY`.

```bash
cp worker/.env.example worker/.env
npm run worker:test
docker compose -f docker-compose.worker.yml up --build
```

Required worker secrets:

```dotenv
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SERVER_ONLY_SERVICE_ROLE_KEY
```

The worker has no HTTP port. Deploy it as an always-on container with restart policy enabled. Suitable targets include Cloud Run worker pools, Fly.io, Railway, Render, or a managed VPS. Do not deploy it as a standard Cloud Run service or a short-lived Vercel function.

The full worker configuration and profile contract are documented in `worker/README.md`.

## Vercel deployment

1. Import the GitHub repository into Vercel.
2. Keep the detected framework preset set to Astro.
3. Add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` to the Production, Preview, and Development environments.
4. Deploy using the default `npm run build` command.
5. Add the production and preview URLs to the Supabase Auth redirect allowlist.

The Vercel adapter runs public project pages and authenticated previews as serverless functions. Media uploads continue to go directly from the administrator browser to Supabase Storage.

No worker configuration is required for the default Vercel deployment. When worker mode is enabled later, deploy it separately after the database migration. If an enabled worker is offline, queued jobs remain safe but admin media processing waits until the worker resumes.

Keep the old website live until the Vercel build is approved, then attach `miracon.gr` in Vercel and update the DNS records in Papaki using the values shown by Vercel.

## Verification

```bash
npm run check
npm run build
npm run worker:test
```
