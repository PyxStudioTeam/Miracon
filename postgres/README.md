# Standalone PostgreSQL schema

This directory is the Phase 1 schema foundation for the pragmatic migration away from Supabase. It contains only application-owned PostgreSQL objects. It does not require Supabase Auth, Storage, RLS, extensions, or the deferred media worker.

## Schema

Apply `migrations/*.sql` in filename order. The final schema lives in the `miracon` namespace and preserves:

- draft and published projects, stable text IDs and slugs, nullable non-negative remaining-unit availability, explicit ordering, publication/update timestamps, presentation fields, JSON content, translation overlays, and hero/walkthrough playlists;
- ordered project images with project-delete cascade and ordered homepage videos whose optional project reference becomes null when a project is deleted;
- the singleton legal-document site settings row, including HTTPS compatibility and same-domain `/media/` URLs;
- owner/editor administrator rows, with `id=1` reserved as the sole owner and sequence-backed editor identifiers beginning at `2`, while retaining the `smallint` key and all session/media references, plus Argon2id password hashes, hashed session and CSRF tokens, expiry/revocation, and hashed login-throttle keys;
- local media metadata using a same-domain `/media/...` URL and a relative filesystem path;
- constrained complete-snapshot revisions and heads for project-plus-images, the homepage playlist, and singleton Site settings, with revision-media references and append-only complete-snapshot audit events;
- transactional project/image save, including omission-safe availability persistence, project reorder/delete, and homepage playlist replacement functions for later repositories.

Legacy single-video columns remain beside the current JSON playlists so transferred Supabase data and the current content mapping retain the same meaning. Worker queue, generated-variant, storage-bucket, and RLS objects are deliberately absent.

Project translation saves match the final Supabase routine: the supplied top-level locale keys replace those complete locale objects, sibling locales remain unchanged, and omitting `translations` preserves the existing translation document.

Migration `0008_admin_governance_and_availability.sql` is additive. It preserves migrations `0001` through `0007`, existing administrator and content identifiers, and live content rows. Stable aggregate-derived UUIDs seed one approved baseline revision and head for every current project plus the homepage and Site settings singletons, including empty homepage state. Baseline source tables are locked against concurrent writers until seeding finishes. Snapshots require exact aggregate-specific top-level keys, exact nested keys for every persisted project, image, homepage-video, and settings column, and typed non-null identities that match their aggregate. The snapshot predicate always returns a boolean and rejects malformed identities rather than yielding SQL `NULL`. Revision snapshots and identity are immutable; a pending proposal may transition once to approved or rejected. Heads can be established from an unbased approved revision and thereafter advance only to a newer approved revision based on the current head. Heads reject `DELETE`; heads, revisions, and audit events reject `TRUNCATE`; audit events reject `UPDATE` and `DELETE`; and `revision_media` rejects all mutation after insertion.

Migration `0009_exact_revision_materialization.sql` adds the approved-revision materialization boundary without changing migrations `0001` through `0008`. The invoker-only routine accepts an approved revision identifier, applies every canonical column including timestamps and complete translation objects, reconstructs the live aggregate, and returns that readback for equality checking before head or audit advancement. Timestamp triggers preserve supplied values only inside the routine's transaction-local context and retain their ordinary `now()` behavior for every other write. Project deletion takes the homepage aggregate and playlist-replacement locks in order and rejects deletion while a homepage video references the project, preventing implicit `ON DELETE SET NULL` drift.

Project `remaining_units` is either `NULL` for unknown availability or a non-negative integer, where `0` means sold out. Legacy project saves that omit the field preserve the stored value.

## Apply migrations

Set a server-only connection URL and run:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE npm run postgres:migrate
```

On PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE'
npm run postgres:migrate
```

The runner records SHA-256 checksums in `miracon_meta.schema_migrations`. One session advisory lock covers metadata initialization, complete-history preflight, and application. Preflight requires the ledger to be an exact checksum-matching prefix of the migration files, rejecting removed files, edited files, and migrations inserted before applied history before any pending SQL runs. Each pending migration still receives its own transaction so failed SQL and its ledger row roll back together.

The database owner can access the schema. Grants for future runtime roles belong to the server/API phase, after those roles are defined.

## Verification

The deterministic contract suite needs no database:

```bash
npm run postgres:test:contract
```

The executable suite intentionally fails rather than skips unless both safety controls are present. `DATABASE_TEST_ALLOW_RESET` must equal `1`, and the database name in `DATABASE_TEST_URL` must contain a distinct `test`, `testing`, `ci`, `disposable`, or `tmp` segment. The tests drop and recreate the `miracon`, `miracon_meta`, and `runner_probe` schemas:

```bash
DATABASE_TEST_ALLOW_RESET=1 DATABASE_TEST_URL=postgresql://USER:PASSWORD@HOST:5432/miracon_test npm run postgres:test:db
```

The executable suites prove repeat and concurrent migration application, ledger drift/missing/out-of-order rejection, failed-migration rollback, clean and existing-schema migration, sole-owner and concurrent editor-ID constraints, isolated Argon2id/hash constraints, preserved administrator references, writer-excluding deterministic baselines, exact complete snapshots, stale-safe monotonic heads, immutable revision/audit/media history, revision-media links, nullable/non-negative availability, transactional project/image rollback, shallow locale replacement and omission preservation, publication timestamps, ordering, cascades, full-row homepage replacement rollback, concurrent whole-playlist replacement, site-settings constraints, sessions, and local-media paths.
