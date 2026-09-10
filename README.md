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

The active runtime variables are server-only `DATABASE_URL`, absolute `MEDIA_ROOT`, canonical `PUBLIC_SITE_URL`, and server-only `CONTACT_DIGEST_SECRET`. Optional contact SMTP notification variables are documented below. The contact secret must be an independently generated value of at least 32 characters and must not be reused for sessions, administrator credentials, or any public integration. Do not expose the database URL, contact secret, or SMTP configuration in a `PUBLIC_*` variable.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_local
MEDIA_ROOT=/absolute/path/to/miracon-media
PUBLIC_SITE_URL=http://127.0.0.1:4321
CONTACT_DIGEST_SECRET=
```

The example intentionally does not contain a real contact digest secret. Production must inject one through protected server configuration; the contact API fails closed when it is absent or shorter than 32 characters.

### Optional contact SMTP notification

SMTP notification is disabled by default. To enable it, set all seven variables in protected server configuration outside the release directory and `public_html`:

```dotenv
CONTACT_SMTP_ENABLED=true
CONTACT_SMTP_HOST=smtp.example.com
CONTACT_SMTP_PORT=587
CONTACT_SMTP_USER=
CONTACT_SMTP_PASSWORD=
CONTACT_SMTP_FROM=website@example.com
CONTACT_SMTP_TO=team@example.com
```

Only port `465` with implicit TLS or port `587` with required STARTTLS is accepted. Certificate verification remains enabled. Each durably accepted contact triggers one bounded plain-text delivery attempt to the single internal `CONTACT_SMTP_TO` recipient, with no pooling or retry. The message includes the accepted contact ID, submitted name, optional email and phone, full message, locale, source path, and acceptance timestamp; it excludes the raw client address and abuse digests. A validated submitted email is used only as `Reply-To`.

Disabled, incomplete, invalid, timed-out, rejected, or otherwise failed SMTP never changes a successful contact response or removes its PostgreSQL row. The API still returns `201`; operators receive a structured warning containing only the contact ID and a safe failure category. This repository does not provision a provider account, DNS records, or SMTP credentials.

Production requires `PUBLIC_SITE_URL=https://miracon.gr`; no other production origin is accepted. The value is read by the standalone runtime and must be an HTTPS origin without a path, query, or fragment. Invalid or missing production configuration fails closed before a request renders. HTTP localhost and loopback origins are accepted only in development or test mode outside a production build.

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
npm run browser:contact:test
```

`npm run browser:contact:test` drives the localized public contact client through real Chromium with same-origin API responses and requires no database. `npm run browser:test:db` uses the same destructive disposable-database safeguards as the other `:db` suites and covers the built standalone service, PostgreSQL persistence, and admin contact review/delete. Set `DATABASE_TEST_ALLOW_RESET=1` and a `DATABASE_TEST_URL` whose database name contains a distinct `test`, `testing`, `ci`, `disposable`, or `tmp` segment; never use development, staging, or production data.

```bash
DATABASE_TEST_ALLOW_RESET=1 \
DATABASE_TEST_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/miracon_test \
npm run browser:test:db
```

`npm run test:db` includes `npm run browser:test:db` after `npm run standalone:test:db`. `npm run release:verify` excludes all guarded database and browser acceptance suites; run it without database-test variables.

## Release and staging acceptance

Use [`docs/production-release-runbook.md`](docs/production-release-runbook.md) for the operator checklist covering artifact inspection, cPanel/Passenger prerequisites, contact retention, staging acceptance, and rollback. GitHub pull requests run the same secret-free `release:verify` gate; guarded database and browser acceptance remain explicit local or controlled-environment steps.

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
5. On staging, provide server-only `DATABASE_URL`, an absolute writable non-symlinked `MEDIA_ROOT`, the canonical HTTPS `PUBLIC_SITE_URL`, and an independently generated server-only `CONTACT_DIGEST_SECRET` of at least 32 characters. Optionally inject the complete server-only `CONTACT_SMTP_*` set outside the release; leave `CONTACT_SMTP_ENABLED=false` otherwise.
6. Run `npm run postgres:migrate` against staging, then provision the administrator if it does not exist.
7. Start the packaged application through `app.js` or `npm start` and confirm `/api/health` reports HTTP 200 with database and media checks true.
8. Verify English and Greek public routes, administrator login and preview, one write/read media flow, and static asset delivery before acceptance.

The release package contract requires `app.js`, `dist/server/entry.mjs`, package manifests, the production release runbook, ordered PostgreSQL migrations, the migration runner, administrator provisioner, and retained import/verification tools. It excludes secrets, tests, logs, local agent/browser/editor state, QA/deploy output, temporary files, and workstation-only export tools.

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

## Contact intake production prerequisites

Contact submissions are retained for 90 days, but the application does not run an in-process scheduler. Before production acceptance, the cPanel operator must configure one daily Cron Jobs entry that executes the packaged release's `node scripts/contact-retention-purge.mjs --apply` with the production `DATABASE_URL`. Run `npm run contact:purge` without `--apply` once after each release to inspect candidates before enabling the schedule.

The production scheduler must satisfy all of these requirements:

1. Use the absolute Node 22 binary path shown by the cPanel Node.js application and the absolute current release directory; cron must not depend on an interactive shell's `PATH` or working directory.
2. Load `DATABASE_URL` from a root-owned or account-owned `0600` file outside `public_html` and outside the release directory. Do not place credentials in the crontab command line or release files.
3. Prevent overlapping runs with `flock`, retain stdout/stderr in an account-private log, and alert the operator when the command exits non-zero.
4. Keep the migration and purge script from the same release. Run `npm run postgres:migrate` before enabling the new release's purge command.

An operator-owned wrapper at `/home/<CPANEL_USER>/bin/miracon-contact-purge` should implement the environment and working-directory boundary:

```sh
#!/bin/sh
set -eu
export DATABASE_URL="$(cat /home/<CPANEL_USER>/.miracon-secrets/database-url)"
cd /home/<CPANEL_USER>/<APP_ROOT>
exec /home/<CPANEL_USER>/<NODE22_PATH>/bin/node scripts/contact-retention-purge.mjs --apply
```

Protect the wrapper and secret with `chmod 700` and `chmod 600` respectively. The corresponding daily cPanel cron entry is:

```cron
17 3 * * * /usr/bin/flock -n /home/<CPANEL_USER>/tmp/miracon-contact-purge.lock /home/<CPANEL_USER>/bin/miracon-contact-purge >> /home/<CPANEL_USER>/logs/miracon-contact-purge.log 2>&1
```

The placeholders and Node path must be replaced with values confirmed in cPanel. This repository does not configure or verify that scheduler.

Contact abuse controls also depend on a trusted Passenger/front-proxy boundary. Before production acceptance, hosting must confirm all of the following:

1. Only the TLS front proxy can reach Passenger/the Node listener. Bind the application to the platform-provided loopback or Unix socket and block direct public access to the Node port in the host firewall.
2. The front proxy discards client-supplied `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`, and `X-Forwarded-Proto`, then overwrites them from the authenticated connection peer and canonical HTTPS request. It must not append an untrusted incoming forwarding chain.
3. Passenger forwards the original `Origin` header unchanged, sets the canonical host/protocol forwarding values, and routes only `miracon.gr` and `www.miracon.gr` to this application, matching `astro.config.mjs` `allowedDomains`.
4. Staging acceptance must prove that spoofed forwarding headers do not change Astro's `clientAddress`, direct Node-port access is unavailable externally, and same-origin contact challenge/submission requests succeed through the public HTTPS proxy.

These scheduler and proxy controls are production prerequisites only. Their presence is not claimed by repository tests or release verification.

## Legacy migration and rollback tooling

The `supabase/`, `worker/`, migration export/import tests, and Supabase-named scripts are retained to transfer historical data, verify parity, or support rollback investigation. They do not define the active deployment architecture and must not be added to the standalone runtime.

Vercel configuration and the old Supabase media worker are likewise legacy references, not supported release targets. Do not reintroduce `@astrojs/vercel`, public Supabase runtime variables, service-role credentials, storage buckets, or worker services into the standalone application. The release intentionally retains only the import and parity tools needed after migration; workstation-only export and media-transfer tools stay outside the package.
