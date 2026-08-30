import type { Pool, QueryResultRow } from 'pg';
import type { AdminRole } from './admin-role';
import { constantTimeEqual, generateOpaqueToken, sha256 } from './crypto';
import type { AuthPool, AuthTransaction } from './database';
import { hashPassword, verifyPassword } from './password';
import { createSession } from './session';
import type { IssuedSession, SessionLifetime } from './session';
import {
  clearLoginThrottle,
  clearStaleLoginThrottles,
  isLoginBlocked,
  lockLoginThrottle,
  loginThrottleDigest,
  recordLoginFailure,
} from './throttle';

interface AdminRow extends QueryResultRow {
  readonly id: number;
  readonly email: string;
  readonly password_hash: string;
  readonly is_active: boolean;
  readonly role: AdminRole;
}

export type AuthenticationResult =
  | { readonly ok: true; readonly adminUserId: number; readonly role: AdminRole }
  | { readonly ok: false };

export type SessionAuthenticationResult =
  | {
      readonly ok: true;
      readonly adminUserId: number;
      readonly role: AdminRole;
      readonly session: IssuedSession;
    }
  | { readonly ok: false };

type AuthenticatedAdmin = {
  readonly adminUserId: number;
  readonly role: AdminRole;
};

export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  readonly clientAddress: string;
  readonly now: Date;
}

let dummyPasswordHashPromise: Promise<string> | null = null;

function dummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = hashPassword(generateOpaqueToken()).catch((error: unknown) => {
      dummyPasswordHashPromise = null;
      throw error;
    });
  }
  return dummyPasswordHashPromise;
}

export async function provisionAdmin(database: Pool, email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  await database.query(
    `insert into miracon.admin_users (id, email, password_hash, role)
     values (1, $1, $2, 'owner')`,
    [normalizedEmail, passwordHash],
  );
}

export async function authenticateAdmin(
  database: AuthPool,
  attempt: LoginAttempt,
): Promise<AuthenticationResult> {
  const result = await authenticateAdminTransaction(database, attempt, () => Promise.resolve());
  return result.ok ? { ok: true, ...result.admin } : result;
}

export async function authenticateAdminAndCreateSession(
  database: AuthPool,
  attempt: LoginAttempt,
  lifetime: SessionLifetime,
): Promise<SessionAuthenticationResult> {
  const result = await authenticateAdminTransaction(database, attempt, (client, admin) =>
    createSession(client, admin.adminUserId, lifetime));
  return result.ok ? { ok: true, ...result.admin, session: result.value } : result;
}

async function authenticateAdminTransaction<Value>(
  database: AuthPool,
  attempt: LoginAttempt,
  onAuthenticated: (client: AuthTransaction, admin: AuthenticatedAdmin) => Promise<Value>,
): Promise<
  | { readonly ok: true; readonly admin: AuthenticatedAdmin; readonly value: Value }
  | { readonly ok: false }
> {
  const normalizedEmail = attempt.email.trim().toLowerCase();
  const throttleDigest = loginThrottleDigest(attempt.clientAddress);
  const client = await database.connect();
  try {
    await client.query('begin');
    await lockLoginThrottle(client, throttleDigest);
    await clearStaleLoginThrottles(client, attempt.now);
    if (await isLoginBlocked(client, throttleDigest, attempt.now)) {
      await client.query('commit');
      return { ok: false };
    }

    const fallbackPasswordHash = await dummyPasswordHash();
    const result = await client.query<AdminRow>(
      `select id, email, password_hash, is_active, role::text as role
       from miracon.admin_users where email = $1 for update`,
      [normalizedEmail],
    );
    const admin = result.rows[0];
    const passwordHash = admin?.password_hash ?? fallbackPasswordHash;
    const passwordMatches = await verifyPassword(passwordHash, attempt.password);
    const emailMatches = admin
      ? constantTimeEqual(sha256(admin.email), sha256(normalizedEmail))
      : false;
    if (!admin || !admin.is_active || !passwordMatches || !emailMatches) {
      await recordLoginFailure(client, throttleDigest, attempt.now);
      await client.query('commit');
      return { ok: false };
    }

    await clearLoginThrottle(client, throttleDigest);
    const authenticatedAdmin = { adminUserId: admin.id, role: admin.role };
    const value = await onAuthenticated(client, authenticatedAdmin);
    await client.query('commit');
    return { ok: true, admin: authenticatedAdmin, value };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
