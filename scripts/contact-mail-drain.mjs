import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  ContactMailConfigurationError,
  ContactMailDeliveryError,
  createContactMailTransport,
  deliverContactMail,
  getContactMailConfig,
} from './contact-mail-delivery.mjs';

const USAGE = 'Usage: node scripts/contact-mail-drain.mjs [--apply]';
const MAX_ATTEMPTS = 10;
const MAX_JOBS_PER_RUN = 100;
const LEASE_MS = 60_000;
const ACK_AGE_MS = 24 * 60 * 60_000;
const TEAM_AGE_MS = 7 * 24 * 60 * 60_000;

export class ContactMailDrainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContactMailDrainError';
  }
}

// One statement locks only the selected job, claims it and retrieves its contact details.
// A recovered lease counts as a new attempt, unless it already exhausted its budget.
const CLAIM_SQL = `
  with candidate as (
    select j.contact_id, j.kind, j.attempts, j.created_at as job_created_at,
           c.id::text as id, c.name, c.email, c.phone, c.message,
           c.locale, c.source_path, c.created_at as contact_created_at,
           (j.attempts >= 10 or j.created_at <= $1::timestamptz -
             case when j.kind = 'ack' then interval '24 hours' else interval '7 days' end) as exhausted
    from miracon.contact_mail_jobs j
    join miracon.contact_submissions c on c.id = j.contact_id
    where (j.state = 'queued' and j.next_attempt_at <= $1)
       or (j.state = 'leased' and j.lease_expires_at <= $1)
    order by j.next_attempt_at, j.created_at, j.contact_id, j.kind
    limit 1
    for update of j skip locked
  ), claimed as (
    update miracon.contact_mail_jobs j
    set state = case when candidate.exhausted then 'dead' else 'leased' end,
        attempts = case when candidate.exhausted then j.attempts else j.attempts + 1 end,
        lease_token = case when candidate.exhausted then null else $2::uuid end,
        lease_expires_at = case when candidate.exhausted then null else $3::timestamptz end,
        last_failure_category = case when candidate.exhausted
          then case when candidate.attempts >= 10 then 'max_attempts' else 'expired' end
          else j.last_failure_category end
    from candidate
    where j.contact_id = candidate.contact_id and j.kind = candidate.kind
    returning j.contact_id, j.kind, j.state, j.attempts, j.lease_token,
              j.created_at, j.last_failure_category
  )
  select claimed.*, candidate.id, candidate.name, candidate.email,
         candidate.phone, candidate.message, candidate.locale,
         candidate.source_path, candidate.contact_created_at
  from claimed join candidate
    on claimed.contact_id = candidate.contact_id and claimed.kind = candidate.kind
`;

/** Claims one due job using FOR UPDATE SKIP LOCKED, granting a 60-second lease. */
export async function claimContactMailJob(database, now) {
  const result = await database.query(CLAIM_SQL, [now, randomUUID(), new Date(now.getTime() + LEASE_MS)]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    attempts: row.attempts,
    leaseToken: row.lease_token,
    createdAt: new Date(row.created_at),
    category: row.last_failure_category,
    contact: {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      message: row.message,
      locale: row.locale,
      sourcePath: row.source_path,
      createdAt: new Date(row.contact_created_at),
    },
  };
}

/** Finalizes only the still-owned lease; a late sender cannot overwrite a reclaimed job. */
export async function completeContactMailJob(database, job, now, category = null) {
  const ageLimit = job.kind === 'ack' ? ACK_AGE_MS : TEAM_AGE_MS;
  const dead = category !== null && (job.attempts >= MAX_ATTEMPTS || now.getTime() - job.createdAt.getTime() >= ageLimit);
  const nextAttemptAt = category && !dead
    ? new Date(now.getTime() + Math.min(60 * 60_000, 60_000 * 2 ** (job.attempts - 1)))
    : null;
  const state = category === null ? 'sent' : dead ? 'dead' : 'queued';
  const result = await database.query(`
    update miracon.contact_mail_jobs
    set state = $4,
        next_attempt_at = coalesce($5::timestamptz, next_attempt_at),
        sent_at = case when $4 = 'sent' then $3::timestamptz else sent_at end,
        lease_token = null,
        lease_expires_at = null,
        last_failure_category = $6
    where contact_id = $1 and kind = $2 and state = 'leased'
      and lease_token = $7::uuid and lease_expires_at > $3
  `, [job.id, job.kind, now, state, nextAttemptAt, category, job.leaseToken]);
  return result.rowCount === 1 ? state : 'lease_lost';
}

/** Processes at most 100 jobs per invocation; failures never disclose message or SMTP details. */
export async function drainContactMail({ database, config, now = () => new Date(), transport, log = () => {}, limit = MAX_JOBS_PER_RUN }) {
  if (config.kind !== 'enabled') throw new ContactMailConfigurationError();
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOBS_PER_RUN) throw new ContactMailDrainError('Invalid contact mail batch size');
  const counts = { sent: 0, queued: 0, dead: 0, leaseLost: 0 };
  for (let index = 0; index < limit; index++) {
    const job = await claimContactMailJob(database, now());
    if (!job) break;
    if (job.state === 'dead') {
      counts.dead++;
      log({ id: job.id, kind: job.kind, category: job.category });
      continue;
    }
    let category = null;
    try {
      await deliverContactMail(job.contact, job.kind, config, transport);
    } catch (error) {
      category = error instanceof ContactMailDeliveryError ? error.category : 'transport_failed';
    }
    const state = await completeContactMailJob(database, job, now(), category);
    if (state === 'lease_lost') counts.leaseLost++;
    else counts[state]++;
    log({ id: job.id, kind: job.kind, category: state === 'lease_lost' ? 'lease_lost' : category ?? 'sent' });
  }
  return { dryRun: false, ...counts };
}

/** Dry run queries counts only; --apply requires both DATABASE_URL and explicitly enabled SMTP. */
export async function runContactMailDrainCli(argumentsList, environment, dependencies = {}) {
  if (argumentsList.length === 1 && argumentsList[0] === '--help') return { usage: USAGE };
  if (argumentsList.length > 1 || (argumentsList.length === 1 && argumentsList[0] !== '--apply')) {
    throw new ContactMailDrainError(USAGE);
  }
  const apply = argumentsList[0] === '--apply';
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new ContactMailDrainError('DATABASE_URL is required');
  const config = apply ? getContactMailConfig(environment) : null;
  if (apply && config.kind !== 'enabled') throw new ContactMailConfigurationError();
  const createPool = dependencies.createPool ?? ((connectionString) => new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'miracon-contact-mail-drain',
  }));
  const database = createPool(databaseUrl);
  try {
    if (!apply) {
      const currentTime = (dependencies.now ?? (() => new Date()))();
      const result = await database.query(`
        select count(*)::integer as count from miracon.contact_mail_jobs
        where (state = 'queued' and next_attempt_at <= $1)
           or (state = 'leased' and lease_expires_at <= $1)
      `, [currentTime]);
      return { dryRun: true, candidates: result.rows[0]?.count ?? 0 };
    }
    const transport = dependencies.transport ?? (dependencies.createTransport ?? createContactMailTransport)(config);
    try {
      return await drainContactMail({ database, config, transport, now: dependencies.now, log: dependencies.log ?? ((event) => console.log(JSON.stringify(event))) });
    } finally {
      if (!dependencies.transport) transport.close?.();
    }
  } finally {
    await database.end();
  }
}

async function main() {
  const result = await runContactMailDrainCli(process.argv.slice(2), process.env);
  console.log('usage' in result ? result.usage : JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof ContactMailDrainError || error instanceof ContactMailConfigurationError
      ? error.message : 'Contact mail drain failed');
    process.exitCode = 1;
  });
}
