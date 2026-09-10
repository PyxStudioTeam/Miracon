# Production Release Runbook

This checklist prepares and validates a MIRACON standalone release. It does not configure cPanel, DNS, TLS, PostgreSQL, the front proxy, or GitHub, and it does not authorize a deployment.

## 1. Repository release gate

- [ ] Use Node 22.12.0 or newer and run `npm ci` from the lockfile.
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
- [ ] Set `PUBLIC_SITE_URL=https://miracon.gr` and an independently generated server-only `CONTACT_DIGEST_SECRET` of at least 32 characters.
- [ ] Leave `CONTACT_SMTP_ENABLED=false` unless optional notification is approved. To enable it, inject `CONTACT_SMTP_ENABLED=true`, `CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT`, `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`, `CONTACT_SMTP_FROM`, and one internal `CONTACT_SMTP_TO` outside the release and `public_html`; never use `PUBLIC_*` names.
- [ ] For enabled SMTP, use only port `465` implicit TLS or port `587` required STARTTLS. Certificate verification is mandatory; the application makes one bounded attempt with no pooling or retry.
- [ ] Restrict secret files to the hosting account, normally mode `0600`, and keep them out of shell history, logs, archives, and the release manifest.
- [ ] Run `npm run postgres:migrate`, then provision or deliberately rotate the administrator using `--password-stdin`.

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

## 5. Staging acceptance

- [ ] Start or restart Passenger and confirm `/api/health` reports HTTP 200 with database and media checks true.
- [ ] Verify English and Greek public routes, canonical metadata, static assets, brochure redirects, and the `www` redirect.
- [ ] Submit one English and one Greek consultation through the public form; verify visible success, PostgreSQL persistence, admin list/detail access, and deletion.
- [ ] First submit with SMTP disabled and verify `201` plus PostgreSQL persistence. If SMTP is enabled, submit once more and verify one internal plain-text notification; a delivery failure must still return `201` and retain the row.
- [ ] Inspect notification warnings for only `event`, contact ID, and safe failure category. They must not contain credentials, SMTP provider detail, message content, submitted contact fields, raw client address, or abuse digests.
- [ ] Verify administrator login, owner/editor authorization, CSRF-protected mutations, previews, and one media write/read flow.
- [ ] Inspect browser console and network activity for CSP violations or requests to obsolete Web3Forms, hCaptcha, or Supabase runtime origins.

SMTP account provisioning, DNS configuration, and provider administration are outside this repository and this runbook.

## 6. Backup, activation, and rollback

- [ ] Capture database and media backups and retain the previous release before activation.
- [ ] Record the release-manifest hash, migration level, active release path, Node version, and acceptance operator.
- [ ] Activate only after all prerequisites pass. Deployment, DNS, and cPanel changes require separate operator authorization.
- [ ] If acceptance fails, restore the previous release path and restart Passenger. Roll back data only with a reviewed database recovery plan; PostgreSQL migrations are forward-applied and are not reversed automatically.
