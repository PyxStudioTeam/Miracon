import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { authenticateAdmin, authenticateAdminAndCreateSession } from '../src/lib/server/auth/login';
import { sha256 } from '../src/lib/server/auth/crypto';
import { hashPassword } from '../src/lib/server/auth/password';
import { loginThrottleDigest } from '../src/lib/server/auth/throttle';
import {
  AdminProvisioningError,
  provisionSingletonAdmin,
  rotateSingletonAdminCredentials,
} from '../scripts/provision-admin.mjs';
import {
  createSession,
  findSession,
  revokeSession,
  verifySessionCsrf,
} from '../src/lib/server/auth/session';

const databaseUrl = requireSafeDatabaseUrl();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
  await provisionSingletonAdmin({
    databaseUrl,
    email: 'Admin@Miracon.Local ',
    password: 'correct horse battery staple',
    rotate: false,
  });
}, 30_000);

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  await pool.query('delete from miracon.login_throttle');
});

describe('database-backed authentication', () => {
  it('provisions the singleton admin with a non-password Argon2id value', async () => {
    const result = await pool.query('select email, password_hash, is_active, role::text from miracon.admin_users');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('admin@miracon.local');
    expect(result.rows[0].password_hash).toMatch(/^\$argon2id\$/u);
    expect(result.rows[0].password_hash).not.toContain('correct horse battery staple');
    expect(result.rows[0].is_active).toBe(true);
    expect(result.rows[0].role).toBe('owner');
  });

  it('returns one generic failure shape for bad credentials and inactive admins', async () => {
    const now = new Date('2026-08-11T12:00:00.000Z');
    const wrongEmail = await authenticateAdmin(pool, {
        email: 'other@example.com', password: 'correct horse battery staple', clientAddress: randomUUID(), now,
    });
    const wrongPassword = await authenticateAdmin(pool, {
        email: 'admin@miracon.local', password: 'wrong', clientAddress: randomUUID(), now,
    });
    await pool.query('update miracon.admin_users set is_active = false where id = 1');
    const inactive = await authenticateAdmin(pool, {
        email: 'admin@miracon.local', password: 'correct horse battery staple', clientAddress: randomUUID(), now,
    });
    await pool.query('update miracon.admin_users set is_active = true where id = 1');

    expect(wrongEmail).toEqual({ ok: false });
    expect(wrongPassword).toEqual({ ok: false });
    expect(inactive).toEqual({ ok: false });
  });

  it('blocks one trusted client after five failures without blocking another client', async () => {
    const clientAddress = '198.51.100.24';
    const start = new Date('2026-08-11T13:00:00.000Z');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await authenticateAdmin(pool, {
        email: 'admin@miracon.local', password: 'wrong', clientAddress, now: start,
      });
    }

    const clientDigest = loginThrottleDigest(clientAddress);
    const row = await pool.query(
      'select key_hash, failed_attempts, blocked_until from miracon.login_throttle where key_hash = $1',
      [clientDigest],
    );
    expect(row.rows[0].failed_attempts).toBe(5);
    expect(row.rows[0].blocked_until).toEqual(new Date('2026-08-11T13:15:00.000Z'));
    expect(row.rows[0].key_hash).toBeInstanceOf(Buffer);
    await expect(authenticateAdmin(pool, {
      email: 'admin@miracon.local', password: 'correct horse battery staple', clientAddress,
      now: new Date('2026-08-11T13:14:59.999Z'),
    })).resolves.toEqual({ ok: false });
    await expect(authenticateAdmin(pool, {
      email: ' ADMIN@MIRACON.LOCAL ', password: 'correct horse battery staple', clientAddress: '198.51.100.99',
      now: new Date('2026-08-11T13:14:59.999Z'),
    })).resolves.toEqual({ ok: true, adminUserId: 1, role: 'owner' });
    await expect(authenticateAdmin(pool, {
      email: 'admin@miracon.local', password: 'correct horse battery staple', clientAddress,
      now: new Date('2026-08-11T13:15:00.000Z'),
    })).resolves.toEqual({ ok: true, adminUserId: 1, role: 'owner' });
  });

  it('authenticates an editor by normalized email and returns the matching live role', async () => {
    // Given
    const password = 'editor correct horse battery staple';
    const editor = await pool.query<{ readonly id: number }>(
      `insert into miracon.admin_users (email, password_hash, role)
       values ($1, $2, 'editor') returning id`,
      ['editor@miracon.local', await hashPassword(password)],
    );
    const editorId = editor.rows[0]?.id;
    if (!editorId) throw new Error('Expected an editor fixture');

    // When
    const authentication = await authenticateAdminAndCreateSession(pool, {
      email: ' EDITOR@MIRACON.LOCAL ', password, clientAddress: randomUUID(),
      now: new Date('2026-08-11T13:30:00.000Z'),
    }, { now: new Date('2026-08-11T13:30:00.000Z'), ttlMs: 60_000 });

    // Then
    expect(authentication).toMatchObject({ ok: true, adminUserId: editorId, role: 'editor' });
    if (!authentication.ok) throw new Error('Expected the editor login to issue a session');
    await expect(findSession(
      pool,
      authentication.session.sessionToken,
      new Date('2026-08-11T13:30:01.000Z'),
    )).resolves.toMatchObject({ adminUserId: editorId, role: 'editor' });
  });

  it('removes a bounded batch of stale throttle rows during authentication', async () => {
    const now = new Date('2026-08-11T15:00:00.000Z');
    const staleAt = new Date('2026-08-09T15:00:00.000Z');
    await Promise.all(Array.from({ length: 101 }, (_, index) => pool.query(
      `insert into miracon.login_throttle (key_hash, failed_attempts, window_started_at, updated_at)
       values ($1, 1, $2, $2)`,
      [sha256(`stale-${index}`), staleAt],
    )));
    await pool.query(
      `insert into miracon.login_throttle (key_hash, failed_attempts, window_started_at, updated_at)
       values ($1, 1, $2, $2)`,
      [sha256('fresh'), now],
    );

    await authenticateAdmin(pool, {
      email: 'admin@miracon.local', password: 'correct horse battery staple', clientAddress: '198.51.100.25', now,
    });

    const remaining = await pool.query(
      "select count(*)::integer as count from miracon.login_throttle where updated_at < $1::timestamptz - interval '1 day'",
      [now],
    );
    const fresh = await pool.query('select key_hash from miracon.login_throttle where key_hash = $1', [sha256('fresh')]);
    expect(remaining.rows[0].count).toBe(1);
    expect(fresh.rows).toHaveLength(1);
  });

  it('refuses administrator overwrite and revokes existing sessions on explicit CLI rotation', async () => {
    // Given
    const input = { databaseUrl, email: 'rotate@miracon.local', password: 'correct horse battery staple', rotate: false };
    await pool.query('update miracon.admin_users set is_active = false where id = 1');
    const issued = await createSession(pool, 1, { now: new Date('2026-08-11T16:00:00.000Z'), ttlMs: 60_000 });

    // When
    await expect(provisionSingletonAdmin(input)).rejects.toBeInstanceOf(AdminProvisioningError);
    await provisionSingletonAdmin({ ...input, rotate: true });
    const admin = await pool.query('select email, is_active from miracon.admin_users where id = 1');
    const previousSession = await findSession(pool, issued.sessionToken, new Date('2026-08-11T16:00:01.000Z'));

    // Then
    expect(admin.rows[0]).toEqual({ email: 'rotate@miracon.local', is_active: true });
    expect(previousSession).toBeNull();
  });

  it('rolls back a rejected editor provision and leaves the database usable', async () => {
    // Given
    const suffix = randomUUID();
    const duplicateEmail = `editor-duplicate-${suffix}@miracon.local`;
    const followingEmail = `editor-following-${suffix}@miracon.local`;
    const input = {
      databaseUrl,
      email: duplicateEmail,
      password: 'editor duplicate correct horse battery staple',
      operation: { kind: 'provision-editor' } as const,
    };
    await provisionSingletonAdmin(input);

    // When
    await expect(provisionSingletonAdmin(input)).rejects.toBeDefined();
    await provisionSingletonAdmin({ ...input, email: followingEmail });
    const editors = await pool.query<{ readonly email: string }>(
      'select email from miracon.admin_users where email = any($1::text[]) order by email',
      [[duplicateEmail, followingEmail]],
    );

    // Then
    expect(editors.rows).toEqual([{ email: duplicateEmail }, { email: followingEmail }]);
  });

  it('provisions a sequence-backed editor and rotates credentials without changing its active state', async () => {
    // Given
    const suffix = randomUUID();
    const oldPassword = 'editor old correct horse battery staple';
    const newPassword = 'editor new correct horse battery staple';
    const oldEmail = `editor-old-${suffix}@miracon.local`;
    await provisionSingletonAdmin({ databaseUrl, email: oldEmail, password: oldPassword, operation: { kind: 'provision-editor' } });
    const editor = await pool.query<{ readonly id: number }>('select id from miracon.admin_users where email = $1', [oldEmail]);
    const editorId = editor.rows[0]?.id;
    if (!editorId) throw new Error('Expected a provisioned editor');
    const issued = await createSession(pool, editorId, { now: new Date('2026-08-22T10:00:00.000Z'), ttlMs: 60_000 });

    // When
    await provisionSingletonAdmin({
      databaseUrl,
      email: `editor-new-${suffix}@miracon.local`,
      password: newPassword,
      operation: { kind: 'rotate-editor', adminId: editorId },
    });
    const rotated = await pool.query('select email, is_active, role::text as role from miracon.admin_users where id = $1', [editorId]);

    // Then
    expect(editorId).toBeGreaterThan(1);
    expect(rotated.rows[0]).toEqual({ email: `editor-new-${suffix}@miracon.local`, is_active: true, role: 'editor' });
    await expect(authenticateAdmin(pool, {
      email: oldEmail, password: oldPassword, clientAddress: randomUUID(), now: new Date('2026-08-22T10:00:01.000Z'),
    })).resolves.toEqual({ ok: false });
    await expect(authenticateAdmin(pool, {
      email: `editor-new-${suffix}@miracon.local`, password: newPassword, clientAddress: randomUUID(), now: new Date('2026-08-22T10:00:01.000Z'),
    })).resolves.toMatchObject({ ok: true, adminUserId: editorId, role: 'editor' });
    await expect(findSession(pool, issued.sessionToken, new Date('2026-08-22T10:00:01.000Z'))).resolves.toBeNull();
  });

  it('deactivates an editor idempotently and revokes every live session immediately', async () => {
    // Given
    const suffix = randomUUID();
    const email = `editor-deactivate-${suffix}@miracon.local`;
    await provisionSingletonAdmin({ databaseUrl, email, password: 'editor deactivate correct horse battery staple', operation: { kind: 'provision-editor' } });
    const editor = await pool.query<{ readonly id: number }>('select id from miracon.admin_users where email = $1', [email]);
    const editorId = editor.rows[0]?.id;
    if (!editorId) throw new Error('Expected a provisioned editor');
    const issued = await createSession(pool, editorId, { now: new Date('2026-08-22T11:00:00.000Z'), ttlMs: 60_000 });

    // When
    await provisionSingletonAdmin({ databaseUrl, operation: { kind: 'deactivate-editor', adminId: editorId } });
    await provisionSingletonAdmin({ databaseUrl, operation: { kind: 'deactivate-editor', adminId: editorId } });
    const deactivated = await pool.query('select is_active from miracon.admin_users where id = $1', [editorId]);

    // Then
    expect(deactivated.rows[0]?.is_active).toBe(false);
    await expect(findSession(pool, issued.sessionToken, new Date('2026-08-22T11:00:01.000Z'))).resolves.toBeNull();
  });

  it('preserves an editor inactive state while rotating its credentials', async () => {
    // Given
    const suffix = randomUUID();
    const oldEmail = `editor-inactive-old-${suffix}@miracon.local`;
    const newEmail = `editor-inactive-new-${suffix}@miracon.local`;
    await provisionSingletonAdmin({ databaseUrl, email: oldEmail, password: 'editor inactive old correct horse battery staple', operation: { kind: 'provision-editor' } });
    const editor = await pool.query<{ readonly id: number }>('select id from miracon.admin_users where email = $1', [oldEmail]);
    const editorId = editor.rows[0]?.id;
    if (!editorId) throw new Error('Expected a provisioned editor');
    await pool.query('update miracon.admin_users set is_active = false where id = $1', [editorId]);

    // When
    await provisionSingletonAdmin({
      databaseUrl,
      email: newEmail,
      password: 'editor inactive new correct horse battery staple',
      operation: { kind: 'rotate-editor', adminId: editorId },
    });
    const rotated = await pool.query('select email, is_active from miracon.admin_users where id = $1', [editorId]);

    // Then
    expect(rotated.rows[0]).toEqual({ email: newEmail, is_active: false });
  });

  it('rejects owner deactivation and unknown lifecycle targets', async () => {
    // Given / When
    await expect(
      provisionSingletonAdmin({ databaseUrl, operation: { kind: 'deactivate-editor', adminId: 1 } }),
    ).rejects.toBeInstanceOf(AdminProvisioningError);
    await expect(
      provisionSingletonAdmin({ databaseUrl, operation: { kind: 'revoke-sessions', adminId: 32_767 } }),
    ).rejects.toBeInstanceOf(AdminProvisioningError);
  });

  it('revokes sessions without changing editor credentials or active state', async () => {
    // Given
    const email = `editor-revoke-${randomUUID()}@miracon.local`;
    await provisionSingletonAdmin({ databaseUrl, email, password: 'editor revoke correct horse battery staple', operation: { kind: 'provision-editor' } });
    const editor = await pool.query<{ readonly id: number; readonly password_hash: string; readonly is_active: boolean }>(
      'select id, password_hash, is_active from miracon.admin_users where email = $1', [email],
    );
    const fixture = editor.rows[0];
    if (!fixture) throw new Error('Expected a provisioned editor');
    const issued = await createSession(pool, fixture.id, { now: new Date('2026-08-22T11:30:00.000Z'), ttlMs: 60_000 });

    // When
    await provisionSingletonAdmin({ databaseUrl, operation: { kind: 'revoke-sessions', adminId: fixture.id } });
    const after = await pool.query<{ readonly password_hash: string; readonly is_active: boolean }>(
      'select password_hash, is_active from miracon.admin_users where id = $1', [fixture.id],
    );

    // Then
    expect(after.rows[0]).toEqual({ password_hash: fixture.password_hash, is_active: true });
    await expect(findSession(pool, issued.sessionToken, new Date('2026-08-22T11:30:01.000Z'))).resolves.toBeNull();
  });

  it('revokes an owner session without changing owner credentials or activity', async () => {
    // Given
    const owner = await pool.query<{ readonly email: string; readonly password_hash: string; readonly is_active: boolean }>(
      'select email, password_hash, is_active from miracon.admin_users where id = 1',
    );
    const fixture = owner.rows[0];
    if (!fixture) throw new Error('Expected the owner fixture');
    const issued = await createSession(pool, 1, { now: new Date('2026-08-22T11:45:00.000Z'), ttlMs: 60_000 });

    // When
    await provisionSingletonAdmin({ databaseUrl, operation: { kind: 'revoke-sessions', adminId: 1 } });
    const after = await pool.query('select email, password_hash, is_active from miracon.admin_users where id = 1');

    // Then
    expect(after.rows[0]).toEqual(fixture);
    await expect(findSession(pool, issued.sessionToken, new Date('2026-08-22T11:45:01.000Z'))).resolves.toBeNull();
  });

  it('serializes concurrent editor provisioning into distinct sequence-generated identities', async () => {
    // Given
    const suffix = randomUUID();
    const firstEmail = `editor-first-${suffix}@miracon.local`;
    const secondEmail = `editor-second-${suffix}@miracon.local`;

    // When
    await Promise.all([
      provisionSingletonAdmin({ databaseUrl, email: firstEmail, password: 'editor first correct horse battery staple', operation: { kind: 'provision-editor' } }),
      provisionSingletonAdmin({ databaseUrl, email: secondEmail, password: 'editor second correct horse battery staple', operation: { kind: 'provision-editor' } }),
    ]);
    const editors = await pool.query<{ readonly id: number; readonly email: string }>(
      'select id, email from miracon.admin_users where email = any($1::text[]) order by email',
      [[firstEmail, secondEmail]],
    );

    // Then
    expect(editors.rows).toHaveLength(2);
    expect(editors.rows[0]?.id).toBeGreaterThan(1);
    expect(editors.rows[1]?.id).toBeGreaterThan(1);
    expect(editors.rows[0]?.id).not.toBe(editors.rows[1]?.id);
  });

  it('refuses provisioning without DATABASE_URL without echoing the password', async () => {
    const password = 'correct horse battery staple';
    const result = provisionSingletonAdmin({ databaseUrl: '', email: 'admin@miracon.local', password, rotate: false });

    await expect(result).rejects.toMatchObject({ message: 'DATABASE_URL is required' });
    await expect(result).rejects.not.toThrow(password);
  });

  it('revokes a session issued by an old-password login that overlaps credential rotation', async () => {
    // Given
    const oldPassword = 'old correct horse battery staple';
    await provisionSingletonAdmin({
      databaseUrl,
      email: 'admin@miracon.local',
      password: oldPassword,
      rotate: true,
    });
    const newPasswordHash = await hashPassword('new correct horse battery staple');
    const loginClient = await pool.connect();
    const rotationClient = await pool.connect();
    const sessionInsertReached = Promise.withResolvers<void>();
    const continueSessionInsert = Promise.withResolvers<void>();
    const rotationLockReached = Promise.withResolvers<void>();
    const loginDatabase = {
      connect: () => Promise.resolve({
        query: async <Row extends QueryResultRow = QueryResultRow>(
          statement: string,
          values?: unknown[],
        ): Promise<QueryResult<Row>> => {
          if (/insert into miracon\.admin_sessions/iu.test(statement)) {
            sessionInsertReached.resolve();
            await continueSessionInsert.promise;
          }
          return loginClient.query<Row>(statement, values);
        },
        release: () => loginClient.release(),
      }),
    };
    const guardedRotationClient = {
      query: async (statement: string, values?: unknown[]) => {
        if (/select id, role::text as role, is_active from miracon\.admin_users where id = \$1 for update/iu.test(statement)) {
          rotationLockReached.resolve();
        }
        return rotationClient.query(statement, values);
      },
    };

    // When
    const login = authenticateAdminAndCreateSession(loginDatabase, {
      email: 'admin@miracon.local',
      password: oldPassword,
      clientAddress: randomUUID(),
      now: new Date('2026-08-20T10:00:00.000Z'),
    }, { now: new Date('2026-08-20T10:00:00.000Z'), ttlMs: 60_000 });
    let rotation = Promise.resolve();
    try {
      await sessionInsertReached.promise;
      rotation = rotateSingletonAdminCredentials(guardedRotationClient, {
        email: 'admin@miracon.local',
        passwordHash: newPasswordHash,
      });
      await rotationLockReached.promise;
      continueSessionInsert.resolve();
      const [loginResult] = await Promise.all([login, rotation]);

      // Then
      expect(loginResult.ok).toBe(true);
      if (!loginResult.ok) throw new Error('Expected the old-password login to issue a session before rotation');
      await expect(findSession(
        pool,
        loginResult.session.sessionToken,
        new Date('2026-08-20T10:00:01.000Z'),
      )).resolves.toBeNull();
    } finally {
      continueSessionInsert.resolve();
      await Promise.allSettled([login, rotation]);
      rotationClient.release();
    }
  });
});

describe('opaque database sessions', () => {
  it('stores digests only and enforces CSRF, expiry, revocation, and active admin state', async () => {
    const now = new Date('2026-08-11T14:00:00.000Z');
    const issued = await createSession(pool, 1, { now, ttlMs: 60_000 });
    const stored = await pool.query(
      'select session_token_hash, csrf_token_hash from miracon.admin_sessions where id = $1', [issued.id],
    );

    expect(stored.rows[0].session_token_hash).toEqual(sha256(issued.sessionToken));
    expect(stored.rows[0].csrf_token_hash).toEqual(sha256(issued.csrfToken));
    expect(JSON.stringify(stored.rows[0])).not.toContain(issued.sessionToken);
    const valid = await findSession(pool, issued.sessionToken, new Date(now.getTime() + 1));
    expect(valid?.adminUserId).toBe(1);
    expect(valid?.role).toBe('owner');
    expect(valid && verifySessionCsrf(valid, issued.csrfToken)).toBe(true);
    expect(valid && verifySessionCsrf(valid, 'wrong')).toBe(false);
    await expect(findSession(pool, issued.sessionToken, new Date(now.getTime() + 60_000))).resolves.toBeNull();

    await pool.query('update miracon.admin_users set is_active = false where id = 1');
    await expect(findSession(pool, issued.sessionToken, new Date(now.getTime() + 2))).resolves.toBeNull();
    await pool.query('update miracon.admin_users set is_active = true where id = 1');
    await revokeSession(pool, issued.sessionToken, new Date(now.getTime() + 2));
    await expect(findSession(pool, issued.sessionToken, new Date(now.getTime() + 3))).resolves.toBeNull();
  });

  it('loads the role from the currently linked live administrator on every request', async () => {
    // Given
    const editor = await pool.query<{ readonly id: number }>(
      `insert into miracon.admin_users (email, password_hash, role)
       values ($1, $2, 'editor') returning id`,
      [`session-editor-${randomUUID()}@miracon.local`, await hashPassword('editor session password')],
    );
    const editorId = editor.rows[0]?.id;
    if (!editorId) throw new Error('Expected an editor fixture');
    const now = new Date('2026-08-11T14:30:00.000Z');
    const issued = await createSession(pool, editorId, { now, ttlMs: 60_000 });

    // When
    const editorSession = await findSession(pool, issued.sessionToken, new Date(now.getTime() + 1));
    await pool.query('update miracon.admin_sessions set admin_user_id = 1 where id = $1', [issued.id]);
    const ownerSession = await findSession(pool, issued.sessionToken, new Date(now.getTime() + 2));

    // Then
    expect(editorSession).toMatchObject({ adminUserId: editorId, role: 'editor' });
    expect(ownerSession).toMatchObject({ adminUserId: 1, role: 'owner' });
  });
});

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  const allowed = process.env.DATABASE_TEST_ALLOW_RESET === '1';
  if (!value || !allowed || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}
