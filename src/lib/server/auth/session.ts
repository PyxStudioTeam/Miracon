import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AdminRole } from './admin-role';
import { generateOpaqueToken, sha256, verifyTokenDigest } from './crypto';
import type { AuthDatabase } from './database';

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface SessionRow extends QueryResultRow {
  readonly id: string;
  readonly admin_user_id: number;
  readonly session_token_hash: Buffer;
  readonly csrf_token_hash: Buffer;
  readonly expires_at: Date;
  readonly role: AdminRole;
  readonly email: string;
  readonly last_seen_at: Date;
}

export interface IssuedSession {
  readonly id: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly adminUserId: number;
  readonly csrfTokenDigest: Buffer;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly role: AdminRole;
  readonly email: string;
}

export interface SessionLifetime {
  readonly now: Date;
  readonly ttlMs: number;
}

export async function createSession(
  database: AuthDatabase,
  adminUserId: number,
  lifetime: SessionLifetime,
): Promise<IssuedSession> {
  const id = randomUUID();
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const expiresAt = new Date(lifetime.now.getTime() + lifetime.ttlMs);
  await database.query(
    `insert into miracon.admin_sessions
       (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at, last_seen_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [id, adminUserId, sha256(sessionToken), sha256(csrfToken), expiresAt, lifetime.now],
  );
  return { id, sessionToken, csrfToken, expiresAt, idleExpiresAt: new Date(lifetime.now.getTime() + SESSION_IDLE_TIMEOUT_MS) };
}

export async function findSession(
  database: AuthDatabase,
  sessionToken: string,
  now: Date,
): Promise<AuthenticatedSession | null> {
  const tokenDigest = sha256(sessionToken);
  const result = await database.query<SessionRow>(
    `select session.id, session.admin_user_id, session.session_token_hash,
       session.csrf_token_hash, session.expires_at, session.last_seen_at,
       admin.role::text as role, admin.email
     from miracon.admin_sessions as session
     join miracon.admin_users as admin on session.admin_user_id = admin.id
     where session.session_token_hash = $1
       and session.revoked_at is null
       and session.expires_at > $2
       and session.last_seen_at > $2::timestamptz - interval '30 minutes'
       and admin.is_active`,
    [tokenDigest, now],
  );
  const row = result.rows[0];
  if (!row || !verifyTokenDigest(sessionToken, row.session_token_hash)) {
    return null;
  }
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    csrfTokenDigest: row.csrf_token_hash,
    expiresAt: row.expires_at,
    idleExpiresAt: new Date(row.last_seen_at.getTime() + SESSION_IDLE_TIMEOUT_MS),
    role: row.role,
    email: row.email,
  };
}

export async function touchSession(
  database: AuthDatabase,
  sessionToken: string,
  now: Date,
): Promise<AuthenticatedSession | null> {
  const result = await database.query<SessionRow>(
    `update miracon.admin_sessions as session
     set last_seen_at = greatest(session.last_seen_at, $2::timestamptz)
     from miracon.admin_users as admin
     where session.session_token_hash = $1
       and session.admin_user_id = admin.id
       and session.revoked_at is null
       and session.expires_at > $2
       and session.last_seen_at > $2::timestamptz - interval '30 minutes'
       and admin.is_active
     returning session.id, session.admin_user_id, session.session_token_hash,
       session.csrf_token_hash, session.expires_at, session.last_seen_at,
       admin.role::text as role, admin.email`,
    [sha256(sessionToken), now],
  );
  const row = result.rows[0];
  if (!row || !verifyTokenDigest(sessionToken, row.session_token_hash)) return null;
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    csrfTokenDigest: row.csrf_token_hash,
    expiresAt: row.expires_at,
    idleExpiresAt: new Date(row.last_seen_at.getTime() + SESSION_IDLE_TIMEOUT_MS),
    role: row.role,
    email: row.email,
  };
}

export function verifySessionCsrf(session: AuthenticatedSession, csrfToken: string): boolean {
  return verifyTokenDigest(csrfToken, session.csrfTokenDigest);
}

export async function rotateSessionCsrf(
  database: AuthDatabase,
  sessionId: string,
): Promise<string> {
  const csrfToken = generateOpaqueToken();
  await database.query(
    'update miracon.admin_sessions set csrf_token_hash = $2 where id = $1',
    [sessionId, sha256(csrfToken)],
  );
  return csrfToken;
}

export async function revokeSession(
  database: AuthDatabase,
  sessionToken: string,
  now: Date,
): Promise<void> {
  await database.query(
    `update miracon.admin_sessions set revoked_at = $2
     where session_token_hash = $1 and revoked_at is null`,
    [sha256(sessionToken), now],
  );
}
