import { describe, expect, it, vi } from 'vitest';
import { verify } from 'argon2';

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(() => Promise.resolve('$argon2id$test-hash')),
  verify: vi.fn(() => Promise.resolve(true)),
}));

import { authenticateAdminAndCreateSession } from '../src/lib/server/auth/login';

describe('login transaction contract', () => {
  it('locks the submitted administrator email until the authenticated session is inserted', async () => {
    // Given
    const statements = [];
    const client = {
      query(statement) {
        const normalized = statement.replace(/\s+/gu, ' ').trim();
        statements.push(normalized);
        if (normalized.includes('from miracon.admin_users')) {
          return Promise.resolve({
            rowCount: 1,
            rows: [{
              id: 1,
              email: 'admin@miracon.local',
              password_hash: '$argon2id$test-hash',
              is_active: true,
              role: 'owner',
            }],
          });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      },
      release() {},
    };
    const database = { connect: () => Promise.resolve(client) };

    // When
    const result = await authenticateAdminAndCreateSession(database, {
      email: 'admin@miracon.local',
      password: 'correct horse battery staple',
      clientAddress: '198.51.100.20',
      now: new Date('2026-08-20T10:00:00.000Z'),
    }, { now: new Date('2026-08-20T10:00:00.000Z'), ttlMs: 60_000 });

    // Then
    expect(result.ok).toBe(true);
    const credentialLock = statements.findIndex((statement) => statement.includes('from miracon.admin_users') && statement.endsWith('for update'));
    const sessionInsert = statements.findIndex((statement) => statement.includes('insert into miracon.admin_sessions'));
    const commit = statements.indexOf('commit');
    expect(statements[0]).toBe('begin');
    expect(credentialLock).toBeGreaterThan(0);
    expect(statements[credentialLock]).toContain('where email = $1');
    expect(sessionInsert).toBeGreaterThan(credentialLock);
    expect(commit).toBeGreaterThan(sessionInsert);
    expect(result).toMatchObject({ ok: true, adminUserId: 1, role: 'owner' });
  });

  it('still performs one argon2 verification against a generated dummy hash for unknown emails', async () => {
    // Given
    const statements = [];
    const client = {
      query(statement) {
        const normalized = statement.replace(/\s+/gu, ' ').trim();
        statements.push(normalized);
        if (normalized.includes('from miracon.admin_users')) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      },
      release() {},
    };
    const database = { connect: () => Promise.resolve(client) };
    const callsBefore = vi.mocked(verify).mock.calls.length;

    // When
    const result = await authenticateAdminAndCreateSession(database, {
      email: 'missing@miracon.local',
      password: 'wrong horse battery staple',
      clientAddress: '198.51.100.21',
      now: new Date('2026-08-20T11:00:00.000Z'),
    }, { now: new Date('2026-08-20T11:00:00.000Z'), ttlMs: 60_000 });

    // Then
    expect(result).toEqual({ ok: false });
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(vi.mocked(verify).mock.calls.length).toBe(callsBefore + 1);
  });
});
