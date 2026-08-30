import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import { removeCleanupCandidate, resolveCleanupRoot } from './local-media-cleanup-filesystem.mjs';
import {
  CLEAR_LOCAL_MEDIA_PENDING_SQL,
  DISCOVER_LOCAL_MEDIA_ORPHANS_SQL,
  FINALIZE_LOCAL_MEDIA_METADATA_SQL,
  LOCK_PENDING_LOCAL_MEDIA_SQL,
  MARK_LOCAL_MEDIA_PENDING_SQL,
} from './local-media-cleanup-query.mjs';

const USAGE = 'Usage: node scripts/local-media-cleanup.mjs [--apply --exclusive-writer] [--grace-days=7]';
const BATCH_SIZE = 500;
const CONTENT_TABLE_LOCK = `
  lock table
    miracon.projects,
    miracon.project_images,
    miracon.homepage_videos,
    miracon.site_settings
  in share mode
`;
const CLEANUP_SESSION_LOCK = `select pg_try_advisory_lock(hashtextextended('miracon-local-media-cleanup', 0)) as acquired`;
const CLEANUP_SESSION_UNLOCK = `select pg_advisory_unlock(hashtextextended('miracon-local-media-cleanup', 0))`;

export class LocalMediaCleanupError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LocalMediaCleanupError';
  }
}

export function parseLocalMediaCleanupArguments(argumentsList) {
  const options = { apply: false, exclusiveWriter: false, graceDays: 7 };
  for (const argument of argumentsList) {
    if (argument === '--apply' && !options.apply) {
      options.apply = true;
      continue;
    }
    if (argument === '--exclusive-writer' && !options.exclusiveWriter) {
      options.exclusiveWriter = true;
      continue;
    }
    if (argument.startsWith('--grace-days=')) {
      const value = Number(argument.slice('--grace-days='.length));
      if (!Number.isInteger(value) || value < 1 || value > 3_650) throw new LocalMediaCleanupError('--grace-days must be an integer from 1 to 3650');
      options.graceDays = value;
      continue;
    }
    throw new LocalMediaCleanupError(USAGE);
  }
  if (options.exclusiveWriter && !options.apply) throw new LocalMediaCleanupError('--exclusive-writer requires --apply');
  if (options.apply && !options.exclusiveWriter) throw new LocalMediaCleanupError('--apply requires --exclusive-writer');
  return options;
}

export async function runLocalMediaCleanup(input) {
  if (input.apply && !input.exclusiveWriter) {
    throw new LocalMediaCleanupError('--apply requires the explicit --exclusive-writer contract');
  }
  const root = await resolveCleanupRoot(input.mediaRoot, LocalMediaCleanupError);
  const siteOrigin = canonicalSiteOrigin(input.siteOrigin);
  const cutoff = new Date(input.now.getTime() - input.graceDays * 86_400_000);
  const queryValues = [cutoff, siteOrigin, BATCH_SIZE];
  const discovered = await input.database.query(DISCOVER_LOCAL_MEDIA_ORPHANS_SQL, queryValues);
  const candidates = discovered.rows.map(mapCandidate);
  if (!input.apply || candidates.length === 0) {
    return { dryRun: !input.apply, cutoff: cutoff.toISOString(), candidates, deleted: [] };
  }

  const client = await input.database.connect();
  let sessionLocked = false;
  try {
    const lock = await client.query(CLEANUP_SESSION_LOCK);
    if (!lock.rows[0]?.acquired) throw new LocalMediaCleanupError('Another local media cleanup apply is already running');
    sessionLocked = true;
    const pending = await markPending(client, candidates, cutoff, siteOrigin);
    await input.hooks?.afterPendingCommit?.();
    const deleted = [];
    for (const candidate of pending) {
      const outcome = await finalizePending(client, candidate, {
        root,
        cutoff,
        siteOrigin,
        hooks: input.hooks,
        removeCandidate: input.filesystem?.removeCandidate ?? removeCleanupCandidate,
      });
      if (outcome) deleted.push(outcome);
    }
    return { dryRun: false, cutoff: cutoff.toISOString(), candidates, deleted };
  } catch (error) {
    if (error instanceof LocalMediaCleanupError) throw error;
    throw new LocalMediaCleanupError('Local media cleanup failed', { cause: error });
  } finally {
    try {
      if (sessionLocked) await client.query(CLEANUP_SESSION_UNLOCK);
    } finally {
      client.release();
    }
  }
}

async function markPending(client, candidates, cutoff, siteOrigin) {
  const scope = JSON.stringify(candidates.map(candidateScope));
  return inTransaction(client, async () => {
    await client.query(CONTENT_TABLE_LOCK);
    const result = await client.query(MARK_LOCAL_MEDIA_PENDING_SQL, [cutoff, siteOrigin, scope]);
    return result.rows.map(mapCandidate);
  });
}

async function finalizePending(client, candidate, context) {
  const scope = JSON.stringify([candidateScope(candidate)]);
  return inTransaction(client, async () => {
    await client.query(CONTENT_TABLE_LOCK);
    const locked = await client.query(LOCK_PENDING_LOCAL_MEDIA_SQL, [context.cutoff, context.siteOrigin, scope]);
    const row = locked.rows[0];
    if (!row) return null;
    if (!row.is_orphan) {
      await client.query(CLEAR_LOCAL_MEDIA_PENDING_SQL, [candidate.id, candidate.relativePath]);
      return null;
    }
    await context.hooks?.beforeUnlink?.(candidate);
    const fileStatus = await context.removeCandidate(context.root, candidate, LocalMediaCleanupError);
    await client.query(FINALIZE_LOCAL_MEDIA_METADATA_SQL, [candidate.id, candidate.relativePath]);
    return { id: candidate.id, relativeUrl: candidate.relativeUrl, relativePath: candidate.relativePath, fileStatus };
  });
}

async function inTransaction(client, action) {
  await client.query('begin isolation level serializable');
  try {
    const result = await action();
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      throw new LocalMediaCleanupError('Local media cleanup rollback failed', { cause: rollbackError });
    }
    throw error;
  }
}

export async function runLocalMediaCleanupCli(argumentsList, environment, dependencies = {}) {
  if (argumentsList.length === 1 && argumentsList[0] === '--help') return { usage: USAGE };
  const options = parseLocalMediaCleanupArguments(argumentsList);
  const databaseUrl = environment.DATABASE_URL?.trim();
  const mediaRoot = environment.MEDIA_ROOT?.trim();
  const siteOrigin = environment.PUBLIC_SITE_URL?.trim();
  if (!databaseUrl) throw new LocalMediaCleanupError('DATABASE_URL is required');
  if (!mediaRoot) throw new LocalMediaCleanupError('MEDIA_ROOT is required');
  if (!siteOrigin) throw new LocalMediaCleanupError('PUBLIC_SITE_URL is required');
  const createPool = dependencies.createPool ?? ((connectionString) => new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'miracon-media-cleanup',
  }));
  const database = createPool(databaseUrl);
  try {
    return await runLocalMediaCleanup({ database, mediaRoot, siteOrigin, now: new Date(), ...options });
  } finally {
    await database.end();
  }
}

function canonicalSiteOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new LocalMediaCleanupError('PUBLIC_SITE_URL must be an HTTP(S) origin without path, query, or fragment');
    }
    return url.origin;
  } catch (error) {
    if (error instanceof LocalMediaCleanupError) throw error;
    throw new LocalMediaCleanupError('PUBLIC_SITE_URL must be an absolute HTTP(S) origin', { cause: error });
  }
}

function candidateScope(candidate) {
  return { id: candidate.id, relative_path: candidate.relativePath };
}

function mapCandidate(row) {
  return {
    id: String(row.id),
    relativeUrl: String(row.relative_url),
    relativePath: String(row.relative_path),
    createdAt: new Date(row.created_at).toISOString(),
    deletionPendingAt: row.deletion_pending_at ? new Date(row.deletion_pending_at).toISOString() : null,
  };
}

async function main() {
  const result = await runLocalMediaCleanupCli(process.argv.slice(2), process.env);
  console.log('usage' in result ? result.usage : JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Local media cleanup failed');
    process.exitCode = 1;
  });
}
