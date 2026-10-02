# Production Release Runbook

This checklist prepares and validates a MIRACON standalone release. It does not configure cPanel, DNS, TLS, PostgreSQL, the front proxy, or GitHub, and it does not authorize a deployment.

## 1. Repository release gate

- [ ] Use Node 22.19.0 or newer and run `npm ci` from the lockfile.
- [ ] Run `npm audit --audit-level=low` and resolve reported advisories before deploying.
- [ ] Run `npm run release:verify` without production secrets or database-test variables.
- [ ] Run `npm run test:db` only with `DATABASE_TEST_ALLOW_RESET=1` and a dedicated disposable `DATABASE_TEST_URL` whose database name contains a safe test marker.
- [ ] Run `npm run release:package -- release-output` and inspect `release-output/release-manifest.json`.
- [ ] Confirm the manifest retains `app.js`, `dist/server/entry.mjs`, package manifests, every ordered PostgreSQL migration, the migration runner, administrator provisioner, contact retention purge, this runbook, and retained import/parity tools.
- [ ] Confirm the artifact excludes `.env*`, credentials, tests, logs, local agent/browser state, QA output, temporary files, media, `node_modules`, and workstation-only exporters.

## 2. Manual cPanel prerequisites

The cPanel operator must complete and record these steps outside the repository:

- [ ] Create or update a Production-mode Node.js application using the cPanel-supported Node 22 binary, the packaged release directory, and startup file `app.js`.
- [ ] Install host-native production dependencies, including the Nodemailer SMTP transport, with `npm ci --omit=dev`; never upload workstation `node_modules`, because `argon2` must match the host ABI.
- [ ] Create the PostgreSQL database and inject server-only `DATABASE_URL` outside the release and `public_html`.
- [ ] Create an absolute writable, non-symlinked `MEDIA_ROOT` outside `public_html`; transfer and verify media separately from the application artifact.
- [ ] Set `PUBLIC_SITE_URL=https://miracon.gr`. For a new installation generate an independent server-only `CONTACT_DIGEST_SECRET` of at least 32 characters; for an existing running installation preserve the current value until the staged rotation in the next step.
- [ ] For SMTP password and `CONTACT_DIGEST_SECRET` in the active public `.htaccess`: provision protected cPanel/Passenger settings with the current values, confirm variable precedence, remove **only secret directives** while preserving Passenger routing, restart and verify contact acceptance and Cron configuration, then rotate both credentials in protected settings and verify again. Back up and coordinate the switch with the operator. HTTP 403 on `.htaccess` does not make a document-root secret safe; rotating first or blindly removing active directives can interrupt contact acceptance.
- [ ] Leave `CONTACT_SMTP_ENABLED=false` unless mail delivery is approved. If enabled, inject `CONTACT_SMTP_ENABLED=true`, `CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT`, `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`, `CONTACT_SMTP_FROM`, and one internal `CONTACT_SMTP_TO` outside the release and `public_html`; never use `PUBLIC_*` names. Enable customer acknowledgements only after controlled tests with `CONTACT_AUTOREPLY_ENABLED=true` (off by default).
- [ ] For SMTP use port `465` with certificate-verified implicit TLS or port `587` with mandatory STARTTLS. The API queues mail atomically with the accepted submission; `201` does not promise delivery. The separate scheduled worker retries, and an ambiguous SMTP acceptance can produce a duplicate.
- [ ] Restrict secret files to the hosting account, normally mode `0600`, and keep them out of shell history, logs, archives, and the release manifest.
- [ ] Inspect the active `public_html`/document root before cutover. After preserving an offline operator-controlled backup and validating the protected replacement configuration, remove legacy `.env`, `.env.*`, `.git/`, source tree, public `.htaccess` secrets, and obsolete release files from that public directory; publishing a clean artifact alone does not remove files already on the server.
- [ ] Verify or configure the database and media backups in section 6, capture the pre-migration copies, then run `npm run postgres:migrate` and provision or deliberately rotate the administrator using `--password-stdin`.

## 3. Passenger and proxy boundary

- [ ] Route only `miracon.gr` and `www.miracon.gr` to Passenger; preserve the original `Origin` header.
- [ ] Terminate TLS at the trusted front proxy and prevent direct public access to the Node listener.
- [ ] Discard client-supplied forwarding headers and overwrite `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`, and `X-Forwarded-Proto` from the trusted connection.
- [ ] Confirm `www` receives a 308 redirect to `https://miracon.gr` with path and query preserved.
- [ ] Prove in staging that spoofed forwarding headers do not change Astro's client address and that same-origin contact challenge/submission requests succeed through the public proxy.

## 4. Contact retention Cron

- [ ] Run `npm run contact:purge` once in dry-run mode after migrations and inspect the candidate count.
- [ ] Configure one daily cPanel Cron job using absolute release and Node paths, a protected database secret, `flock`, an account-private log, and non-zero-exit alerting.
- [ ] Execute `node scripts/contact-retention-purge.mjs --apply` from the current release. Do not put `DATABASE_URL` directly in the crontab.

## 4a. Contact mail Cron

- [ ] Run migrations, then `npm run contact:mail:drain` from the active release to inspect the due count without sending. `--apply` requires valid SMTP settings; do not use a real customer email for the first delivery test.
- [ ] Set up one **every-minute** cPanel Cron entry with absolute release/Node paths, account-private environment and log, a separate `flock` lock, and non-zero-exit alerting: `node scripts/contact-mail-drain.mjs --apply`. Load the database URL and SMTP variables from protected cPanel configuration or `0600` operator-controlled secrets **outside** `public_html` and the release; never put passwords in the crontab, CLI arguments or log. Confirm that cPanel Cron actually inherits or explicitly loads those values.
- [ ] Monitor `dead` and overdue queued jobs, failure categories, and worker exit code; inspect and resolve SMTP outages rather than deleting or endlessly resending customer acknowledgements.

## 5. Staging acceptance

- [ ] Start or restart Passenger and confirm `/api/health` reports HTTP 200 with database and media checks true.
- [ ] Verify English and Greek public routes, canonical metadata, static assets, brochure redirects, and the `www` redirect.
- [ ] On a real Android phone in Opera, including opening the site from a Yandex search result, verify that the original 1280×720, 60 fps homepage MP4 autoplays muted on the **first** visit, on Wi-Fi and mobile data, without switching languages or tapping the video. If the mobile codec fails, confirm the existing desktop 30 fps video is used instead. Repeat for `/el/`. If browser policy blocks all autoplay, the poster remains; there is intentionally no manual play control, so that device fails autoplay acceptance. Desktop Chromium emulation does not satisfy this check.
- [ ] Submit one English and one Greek consultation through the public form; verify visible success, PostgreSQL contact and `contact_mail_jobs` persistence, read-only admin list/detail, full UTF-8 CSV export, and retention cleanup in the guarded maintenance workflow.
- [ ] With SMTP disabled, verify HTTP `201` and two queued team jobs. Then configure a controlled staging SMTP inbox, run the mail worker `--apply`, and verify one plain-text internal message per contact. Switch on `CONTACT_AUTOREPLY_ENABLED=true` only with an operator-controlled EN/EL recipient; verify the bilingual reply, no submitted text in its body, and at most one reply to the same address within rolling 24 hours. An SMTP failure must retain the contact and retry the mail job without blocking HTTP `201`.
- [ ] Under **Settings → Legal documents**, switch EN/ΕΛ: upload distinct controlled PDF files, confirm each language's Terms/Cookie visibility is independent, and verify the Greek footer and consent form link to the Greek policy (not the English upload). If no policy was uploaded, confirm the bundled locale-specific PDF is served. Editors' uploads must remain proposals until owner approval. Migrate `0021_localized_legal_documents.sql` before enabling this flow.
- [ ] Inspect mail worker warnings and job state for only safe failure categories and contact IDs. They must not contain credentials, SMTP provider detail, message content, submitted contact fields, raw client address, or abuse digests. Check SPF, DKIM and DMARC against the sending domain and provider requirements.
- [ ] Verify administrator login, owner/editor authorization, CSRF-protected mutations, previews, and one media write/read flow.
- [ ] In a guarded staging/disposable database, verify an admin session remains valid after 29:59.999 of idle time and is denied at 30:00, even if GETs/preview/CSRF requests are made. Confirm protected API and media requests return 401 and preview redirects to `/admin`; the 8-hour absolute limit still applies. Verify real interaction in `/admin` extends only the idle deadline, while merely focusing the tab does not. Check another active tab refreshes the first tab's status without sending a heartbeat on its behalf, and explicit sign-out clears both tabs. Do not use a production session or alter production `last_seen_at` for this test.
- [ ] As editor, submit a project/photo change and a site or hero change; as owner, open **Work → Review changes** and inspect current HEAD versus proposed text and photo previews, plus both raw JSON snapshots. Verify direct list approval is unavailable. Change HEAD before reviewing an existing proposal: it must be marked outdated in list and review, approval disabled even when visible fields match, rejection still possible, and a concurrent 409 must refresh the comparison. Confirm successful approval publishes only the reviewed revision after server conflict checks.
- [ ] Without logging in, request `/api/admin/projects`, `/api/admin/site-settings`, `/api/admin/contacts`, and `/api/admin/contacts/export`; each must return HTTP 401 without private data. Public `/api/health` and consultation endpoints are intentionally accessible and are not admin endpoints.
- [ ] After cutover, request `/.env`, `/.env.local`, `/.git/HEAD`, and any other formerly deployed sensitive path through the public origin. Require HTTP 404 (not HTTP 403); HTTP 403 means the files may still exist in the document root. Also verify the deployed release manifest contains neither `.git` nor `.env*`.
- [ ] Inspect browser console and network activity for CSP violations or requests to obsolete Web3Forms, hCaptcha, or Supabase runtime origins.

SMTP account provisioning, DNS configuration, and provider administration are outside this repository and this runbook.

## 6. Backup, activation, and rollback

- [ ] Capture database and media backups and retain the previous release before activation.
- [ ] **Backup status is not verified by this repository.** Before release, the hosting operator must record whether production PostgreSQL and `MEDIA_ROOT` backups already run, their actual schedule, owner, off-host destination, encryption/access controls, retention, latest successful run, and latest successful restore test. Do not treat a 403 on a live secret path as evidence that backups or cleanup are configured.
- [ ] If no verifiable backup exists, configure a daily consistent PostgreSQL dump (`pg_dump` with noninteractive protected credentials), a daily backup of `MEDIA_ROOT`, and a backup immediately before migrations or release activation. Keep encrypted copies outside `public_html`, the release, and the hosting account where possible; retain at least 30 daily copies and alert on missing or failed jobs. Test restoration of both database and files into an isolated disposable environment at least monthly. Record who restores, recovery steps, and the last tested restore before activating production.
- [ ] Record the release-manifest hash, migration level, active release path, Node version, and acceptance operator.
- [ ] Activate only after all prerequisites pass. Deployment, DNS, and cPanel changes require separate operator authorization.
- [ ] If acceptance fails, restore the previous release path and restart Passenger. Roll back data only with a reviewed database recovery plan; PostgreSQL migrations are forward-applied and are not reversed automatically.
