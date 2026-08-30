import type { QueryResultRow } from 'pg';
import { sha256 } from './crypto';
import type { AuthDatabase } from './database';

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_BLOCK_MINUTES = 15;
export const LOGIN_THROTTLE_RETENTION_DAYS = 1;
export const LOGIN_THROTTLE_CLEANUP_BATCH_SIZE = 100;

interface ThrottleRow extends QueryResultRow {
  readonly blocked_until: Date | null;
  readonly failed_attempts: number;
}

export function loginThrottleDigest(clientAddress: string): Buffer {
  return sha256(`client-address\0${clientAddress}`);
}

export async function lockLoginThrottle(database: AuthDatabase, keyDigest: Buffer): Promise<void> {
  await database.query(
    `select pg_advisory_xact_lock(hashtextextended(encode($1::bytea, 'hex'), 0))`,
    [keyDigest],
  );
}

export async function isLoginBlocked(
  database: AuthDatabase,
  keyDigest: Buffer,
  now: Date,
): Promise<boolean> {
  const result = await database.query<ThrottleRow>(
    `select blocked_until, failed_attempts
     from miracon.login_throttle
     where key_hash = $1`,
    [keyDigest],
  );
  const row = result.rows[0];
  return row?.blocked_until !== null && row?.blocked_until !== undefined && row.blocked_until > now;
}

export async function recordLoginFailure(
  database: AuthDatabase,
  keyDigest: Buffer,
  now: Date,
): Promise<void> {
  await database.query(
    `insert into miracon.login_throttle
       (key_hash, failed_attempts, window_started_at, blocked_until, updated_at)
     values ($1, 1, $2, null, $2)
     on conflict (key_hash) do update set
       failed_attempts = case
         when miracon.login_throttle.window_started_at <= $2 - interval '15 minutes' then 1
         else miracon.login_throttle.failed_attempts + 1
       end,
       window_started_at = case
         when miracon.login_throttle.window_started_at <= $2 - interval '15 minutes' then $2
         else miracon.login_throttle.window_started_at
       end,
       blocked_until = case
         when miracon.login_throttle.window_started_at <= $2 - interval '15 minutes' then null
         when miracon.login_throttle.failed_attempts + 1 >= 5 then $2 + interval '15 minutes'
         else miracon.login_throttle.blocked_until
       end,
       updated_at = $2`,
    [keyDigest, now],
  );
}

export async function clearLoginThrottle(database: AuthDatabase, keyDigest: Buffer): Promise<void> {
  await database.query('delete from miracon.login_throttle where key_hash = $1', [keyDigest]);
}

export async function clearStaleLoginThrottles(database: AuthDatabase, now: Date): Promise<void> {
  await database.query(
    `delete from miracon.login_throttle
     where key_hash in (
       select key_hash from miracon.login_throttle
       where updated_at < $1::timestamptz - interval '1 day'
       order by updated_at
       limit 100
     )`,
    [now],
  );
}
