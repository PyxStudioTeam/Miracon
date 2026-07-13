# MIRACON website and Project Desk

The public MIRACON website and its custom project administration panel live in one Astro application.

## Stack

- Astro in SSR mode with the Vercel adapter
- React for `/admin`
- Supabase PostgreSQL, Auth, and Storage
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

On the first authenticated visit, an empty database shows an **Import current website projects** action. It imports the five projects bundled in `src/data/projects.ts`.

## Content workflow

- Draft projects are available only to the administrator.
- Published projects appear in the catalog and at `/projects/[slug]`.
- Unpublishing removes the public project without deleting its content.
- Preview is rendered at `/preview/[slug]`, requires the administrator session, has `noindex`, and is sent with `Cache-Control: private, no-store`.
- Project and gallery ordering are stored explicitly and can be changed by drag and drop.
- Images and video are uploaded to `project-media`; PDF brochures are uploaded to `project-documents`.

## Vercel deployment

1. Import the GitHub repository into Vercel.
2. Keep the detected framework preset set to Astro.
3. Add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` to the Production, Preview, and Development environments.
4. Deploy using the default `npm run build` command.
5. Add the production and preview URLs to the Supabase Auth redirect allowlist.

The Vercel adapter runs public project pages and authenticated previews as serverless functions. Media uploads continue to go directly from the administrator browser to Supabase Storage.

Keep the old website live until the Vercel build is approved, then attach `miracon.gr` in Vercel and update the DNS records in Papaki using the values shown by Vercel.

## Verification

```bash
npm run check
npm run build
```
