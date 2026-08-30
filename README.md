# MIRACON website and Project Desk

The public MIRACON website and its administration panel run as one standalone Astro Node application backed by PostgreSQL and local filesystem media.

## Active stack

- Astro SSR with `@astrojs/node` standalone output
- React for `/admin`; static CSS and vanilla JavaScript for the public site chrome
- PostgreSQL migrations in `postgres/migrations/`
- Server-side sessions, CSRF protection, and singleton administrator provisioning
- Local media under an absolute `MEDIA_ROOT`, served from same-origin `/media/` URLs

Supabase, its media worker, and Vercel are not active runtime dependencies. Their scripts and documentation remain only for migration, comparison, and rollback work; see [Legacy migration and rollback tooling](#legacy-migration-and-rollback-tooling).

## Local development

Use Node `>=22.12.0`, a local PostgreSQL database, and an absolute writable media directory.

```bash
npm install
cp .env.example .env.local
npm run postgres:migrate
npm run dev
```

The active runtime variables are server-only `DATABASE_URL`, absolute `MEDIA_ROOT`, and canonical `PUBLIC_SITE_URL`. Do not expose the database URL in a `PUBLIC_*` variable.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_local
MEDIA_ROOT=/absolute/path/to/miracon-media
PUBLIC_SITE_URL=http://127.0.0.1:4321
```

On PowerShell, set environment variables with `$env:NAME = 'value'`. The `.env.example` Supabase values are legacy migration inputs, not requirements for development or production.

## Database and administrator

Apply `postgres/migrations/*.sql` in filename order through the migration runner:

```bash
npm run postgres:migrate
```

After migrations, provision the singleton administrator. Supply the password over standard input so it is not stored in shell history:

```bash
printf '%s' 'a-long-unique-password' | npm run admin:provision -- --email=admin@example.com --password-stdin
```

Provisioning refuses to replace an existing administrator. Credential rotation must be explicit:

```bash
printf '%s' 'a-new-long-unique-password' | npm run admin:provision -- --email=admin@example.com --password-stdin --rotate
```

The initial command provisions the sole owner at `id=1`. Editors receive database-generated IDs and can be provisioned without supplying one:

```bash
printf '%s' 'an-editor-password' | npm run admin:provision -- --role=editor --email=editor@example.com --password-stdin
printf '%s' 'a-new-editor-password' | npm run admin:provision -- --rotate --admin-id=2 --email=editor@example.com --password-stdin
npm run admin:provision -- --deactivate --admin-id=2
npm run admin:provision -- --revoke-sessions --admin-id=2
```

Owner rotation omits `--admin-id`; editor rotation requires an editor ID. Deactivation is editor-only and idempotent. Rotation, deactivation, and explicit revocation immediately revoke the target's active sessions. Passwords are accepted only through `--password-stdin`.

The schema and migration ledger contract are documented in [`postgres/README.md`](postgres/README.md).

## Testing

The default suite is deterministic and does not read `DATABASE_TEST_URL`:

```bash
npm test
```

Vitest receives only explicitly listed Vitest files. Node's test runner owns the PostgreSQL contracts, migration tooling, and release tests, so Node `.mjs` suites are not discovered by Vitest directory scans.

### Disposable database suites

Database suites are deliberately separate and always end in `:db`. They fail, rather than skip, unless both safeguards are present:

- `DATABASE_TEST_ALLOW_RESET=1`
- `DATABASE_TEST_URL` names a disposable database with a distinct `test`, `testing`, `ci`, `disposable`, or `tmp` segment

Create a dedicated local database with your normal PostgreSQL administration tools, then run the complete database acceptance suite. These tests drop and recreate application-owned test schemas; never point them at development, staging, or production data.

```bash
createdb miracon_test
DATABASE_TEST_ALLOW_RESET=1 \
DATABASE_TEST_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_test \
npm run test:db
```

PowerShell equivalent:

```powershell
createdb miracon_test
$env:DATABASE_TEST_ALLOW_RESET = '1'
$env:DATABASE_TEST_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_test'
npm run test:db
```

Individual guarded commands include `postgres:test:db`, `auth:test:db`, `api:test:db`, `api:test:http:db`, `server:test:db`, `media:test:db`, `migration:import:test:db`, `standalone:test:db`, and `browser:test:db`.

### Browser acceptance

Install the Playwright-managed Chromium browser once, then create a fresh standalone build before browser acceptance:

```bash
npm run browser:install
npm run build
```

`npm run browser:test:db` uses the same destructive disposable-database safeguards as the other `:db` suites. Set `DATABASE_TEST_ALLOW_RESET=1` and a `DATABASE_TEST_URL` whose database name contains a distinct `test`, `testing`, `ci`, `disposable`, or `tmp` segment; never use development, staging, or production data.

```bash
DATABASE_TEST_ALLOW_RESET=1 \
DATABASE_TEST_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_test \
npm run browser:test:db
```

`npm run test:db` includes `npm run browser:test:db` after `npm run standalone:test:db`. `npm run release:verify` excludes all guarded database and browser acceptance suites; run it without database-test variables.

## Release and staging acceptance

The safe release gate needs no database and does not claim database acceptance:

```bash
npm run release:verify
```

It runs `astro check`, a standalone build, deterministic application tests, schema contracts, migration tooling tests, and release package tests. Database acceptance is separate and requires the guarded disposable database workflow above.

Exact staging prerequisites:

1. Use Node `>=22.12.0` and install the lockfile with `npm ci`.
2. Run `npm run release:verify` without database-test variables.
3. Run `npm run test:db` against a disposable database, never the staging database.
4. Create the release with `npm run release:package -- release-output`; inspect `release-manifest.json`.
5. On staging, provide server-only `DATABASE_URL`, an absolute writable non-symlinked `MEDIA_ROOT`, and the canonical HTTPS `PUBLIC_SITE_URL`.
6. Run `npm run postgres:migrate` against staging, then provision the administrator if it does not exist.
7. Start the packaged application through `app.js` or `npm start` and confirm `/api/health` reports HTTP 200 with database and media checks true.
8. Verify English and Greek public routes, administrator login and preview, one write/read media flow, and static asset delivery before acceptance.

The release package contract requires `app.js`, `dist/server/entry.mjs`, package manifests, ordered PostgreSQL migrations, the migration runner, administrator provisioner, and retained import/verification tools. It excludes secrets, tests, logs, local agent/browser state, QA/deploy output, temporary files, and workstation-only export tools.

## Content and media operations

- Draft projects and previews require an administrator session; published projects appear at `/projects/[slug]`.
- English uses unprefixed routes and Greek uses `/el/*`.
- Project, gallery, and homepage ordering are stored explicitly in PostgreSQL.
- Uploads are written beneath `MEDIA_ROOT`; the database stores same-origin URLs and relative paths.
- Preview responses remain private and non-indexable.

Media cleanup defaults to dry-run:

```bash
npm run media:cleanup -- --grace-days=7
```

Apply mode requires the documented exclusive-writer assertion. Stop every process that can modify `MEDIA_ROOT` before running it and keep them stopped until completion:

```bash
npm run media:cleanup -- --apply --exclusive-writer --grace-days=7
```

## Legacy migration and rollback tooling

The `supabase/`, `worker/`, migration export/import tests, and Supabase-named scripts are retained to transfer historical data, verify parity, or support rollback investigation. They do not define the active deployment architecture and must not be added to the standalone runtime.

Vercel configuration and the old Supabase media worker are likewise legacy references, not supported release targets. Do not reintroduce `@astrojs/vercel`, public Supabase runtime variables, service-role credentials, storage buckets, or worker services into the standalone application. The release intentionally retains only the import and parity tools needed after migration; workstation-only export and media-transfer tools stay outside the package.
