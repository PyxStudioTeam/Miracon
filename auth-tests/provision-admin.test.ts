import { describe, expect, it, vi } from 'vitest';

const databaseQueries = vi.hoisted(() => [] as string[]);
const failedStatement = vi.hoisted(() => ({ value: '' }));
const lockedOwnerPresent = vi.hoisted(() => ({ value: true }));
const returnedEditorId = vi.hoisted(() => ({ value: 2 }));

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: () => Promise.resolve('$argon2id$test-hash'),
}));

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect(): Promise<void> {
        return Promise.resolve();
      }

      query(statement: string, values?: readonly unknown[]): Promise<{ readonly rowCount: number; readonly rows: readonly { readonly id: number; readonly role: string; readonly is_active: boolean }[] }> {
        const normalized = statement.replace(/\s+/gu, ' ').trim();
        databaseQueries.push(normalized);
        if (failedStatement.value && normalized.includes(failedStatement.value)) {
          return Promise.reject(new Error('database failure'));
        }
        if (normalized.includes('select id, role::text as role, is_active')) {
          const adminId = values?.[0];
          if (adminId === 1 && !lockedOwnerPresent.value) {
            return Promise.resolve({ rowCount: 0, rows: [] });
          }
          return Promise.resolve({
            rowCount: 1,
            rows: [{ id: typeof adminId === 'number' ? adminId : 1, role: adminId === 1 ? 'owner' : 'editor', is_active: true }],
          });
        }
        if (normalized.includes('returning id')) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: normalized.includes('(email, password_hash, role)') ? returnedEditorId.value : 1, role: 'editor', is_active: true }] });
        }
        return Promise.resolve({ rowCount: 1, rows: [] });
      }

      end(): Promise<void> {
        return Promise.resolve();
      }
    },
  },
}));

import {
  AdminProvisioningError,
  parseProvisioningArguments,
  provisionSingletonAdmin,
  validateProvisioningInput,
} from '../scripts/provision-admin.mjs';

describe('administrator lifecycle argument parsing', () => {
  it('returns discriminated editor lifecycle operations', () => {
    // Given
    const editorProvision = ['--role=editor', '--email=editor@miracon.test', '--password-stdin'];
    const editorRotation = ['--rotate', '--admin-id=2', '--email=editor@miracon.test', '--password-stdin'];

    // When
    const provision = parseProvisioningArguments(editorProvision);
    const rotation = parseProvisioningArguments(editorRotation);
    const deactivation = parseProvisioningArguments(['--deactivate', '--admin-id=2']);
    const revocation = parseProvisioningArguments(['--revoke-sessions', '--admin-id=1']);

    // Then
    expect(provision).toEqual({ kind: 'provision-editor', email: 'editor@miracon.test' });
    expect(rotation).toEqual({ kind: 'rotate-editor', adminId: 2, email: 'editor@miracon.test' });
    expect(deactivation).toEqual({ kind: 'deactivate-editor', adminId: 2 });
    expect(revocation).toEqual({ kind: 'revoke-sessions', adminId: 1 });
  });

  it('accepts the owner defaults and rejects unsafe flag combinations', () => {
    // Given
    const ownerProvision = ['--email=owner@miracon.test', '--password-stdin'];
    const ownerRotation = ['--rotate', '--email=owner@miracon.test', '--password-stdin'];
    const unsafeArguments = [
      ['--role=editor', '--rotate', '--email=editor@miracon.test', '--password-stdin'],
      ['--rotate', '--admin-id=1', '--email=owner@miracon.test', '--password-stdin'],
      ['--deactivate', '--admin-id=1'],
      ['--revoke-sessions', '--admin-id=2', '--password-stdin'],
      ['--deactivate', '--admin-id=2', '--email=editor@miracon.test'],
      ['--role=editor', '--admin-id=2', '--email=editor@miracon.test', '--password-stdin'],
      ['--deactivate', '--admin-id=2.5'],
      ['--deactivate', '--admin-id=0'],
      ['--deactivate', '--admin-id=-2'],
      ['--deactivate', '--admin-id=2', '--deactivate'],
      ['--email=first@miracon.test', '--email=second@miracon.test', '--password-stdin'],
      ['--password=secret', '--email=owner@miracon.test', '--password-stdin'],
      ['--email=owner@miracon.test'],
      ['--password-stdin'],
      ['--unknown', '--email=owner@miracon.test', '--password-stdin'],
    ];

    // When / Then
    expect(parseProvisioningArguments(ownerProvision)).toEqual({ kind: 'provision-owner', email: 'owner@miracon.test' });
    expect(parseProvisioningArguments(ownerRotation)).toEqual({ kind: 'rotate-owner', email: 'owner@miracon.test' });
    for (const argumentsList of unsafeArguments) {
      expect(() => parseProvisioningArguments(argumentsList)).toThrow(AdminProvisioningError);
    }
  });

  it('normalizes credential emails and rejects invalid credentials before database work', () => {
    // Given
    const validInput = {
      databaseUrl: 'postgres://runtime-database',
      email: ' OWNER@MIRACON.TEST ',
      password: 'x'.repeat(16),
      operation: { kind: 'provision-owner' } as const,
    };

    // When
    const normalized = validateProvisioningInput(validInput);

    // Then
    expect(normalized.email).toBe('owner@miracon.test');
    expect(() => validateProvisioningInput({ ...validInput, email: 'not-an-email' })).toThrow(AdminProvisioningError);
    expect(() => validateProvisioningInput({ ...validInput, password: 'short' })).toThrow(AdminProvisioningError);
    expect(() => validateProvisioningInput({ ...validInput, password: 'x x x x x x x x x x x x x x x ' })).toThrow(AdminProvisioningError);
    expect(validateProvisioningInput({ ...validInput, password: 'internal spaces still count' }).password).toBe('internal spaces still count');
  });
});

describe('administrator credential rotation', () => {
  it('provisions a fresh id=1 administrator explicitly as owner', async () => {
    // Given
    databaseQueries.length = 0;
    lockedOwnerPresent.value = false;

    // When
    await provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'admin@miracon.test',
      password: 'x'.repeat(16),
      rotate: false,
    });

    // Then
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      "insert into miracon.admin_users (id, email, password_hash, role) values (1, $1, $2, 'owner') returning id",
      'commit',
    ]);
    lockedOwnerPresent.value = true;
  });

  it('revokes existing sessions in the credential update transaction', async () => {
    // Given
    databaseQueries.length = 0;

    // When
    await provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'admin@miracon.test',
      password: 'x'.repeat(16),
      rotate: true,
    });

    // Then
    expect(databaseQueries[0]).toBe('begin');
    expect(databaseQueries[1]).toContain('select id, role::text as role, is_active from miracon.admin_users where id = $1 for update');
    expect(databaseQueries[2]).toContain('select id from miracon.admin_sessions where admin_user_id = $1 order by id for update');
    expect(databaseQueries[3]).toContain('update miracon.admin_users set email = $2, password_hash = $3, is_active = true where id = $1');
    expect(databaseQueries[4]).toBe('update miracon.admin_sessions set revoked_at = now() where admin_user_id = $1 and revoked_at is null');
    expect(databaseQueries[5]).toBe('commit');
  });

  it('provisions editors without a caller-provided id and validates a sequence-backed result', async () => {
    // Given
    databaseQueries.length = 0;

    // When
    await provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'editor@miracon.test',
      password: 'x'.repeat(16),
      operation: { kind: 'provision-editor' },
    });

    // Then
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      "insert into miracon.admin_users (email, password_hash, role) values ($1, $2, 'editor') returning id",
      'commit',
    ]);
    expect(databaseQueries[2]).not.toContain('(id,');
  });

  it('rolls back an editor insert when its returned identifier is unsafe', async () => {
    // Given
    databaseQueries.length = 0;
    returnedEditorId.value = 1;

    // When
    const operation = provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'editor-invalid-id@miracon.test',
      password: 'x'.repeat(16),
      operation: { kind: 'provision-editor' },
    });

    // Then
    await expect(operation).rejects.toBeInstanceOf(AdminProvisioningError);
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      "insert into miracon.admin_users (email, password_hash, role) values ($1, $2, 'editor') returning id",
      'rollback',
    ]);
    returnedEditorId.value = 2;
  });

  it('rolls back a fresh owner insert when commit fails', async () => {
    // Given
    databaseQueries.length = 0;
    lockedOwnerPresent.value = false;
    failedStatement.value = 'commit';

    // When
    const operation = provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'owner-rollback@miracon.test',
      password: 'x'.repeat(16),
      operation: { kind: 'provision-owner' },
    });

    // Then
    await expect(operation).rejects.toThrow('database failure');
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      "insert into miracon.admin_users (id, email, password_hash, role) values (1, $1, $2, 'owner') returning id",
      'commit',
      'rollback',
    ]);
    failedStatement.value = '';
    lockedOwnerPresent.value = true;
  });

  it('locks and rolls back when owner provisioning finds the reserved identity', async () => {
    // Given
    databaseQueries.length = 0;
    lockedOwnerPresent.value = true;

    // When
    const operation = provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'owner-exists@miracon.test',
      password: 'x'.repeat(16),
      operation: { kind: 'provision-owner' },
    });

    // Then
    await expect(operation).rejects.toBeInstanceOf(AdminProvisioningError);
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      'rollback',
    ]);
  });

  it('deactivates an editor only after locking the user and sessions in order', async () => {
    // Given
    databaseQueries.length = 0;

    // When
    await provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      operation: { kind: 'deactivate-editor', adminId: 2 },
    });

    // Then
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      'select id from miracon.admin_sessions where admin_user_id = $1 order by id for update',
      'update miracon.admin_users set is_active = false where id = $1',
      'update miracon.admin_sessions set revoked_at = now() where admin_user_id = $1 and revoked_at is null',
      'commit',
    ]);
  });

  it('rolls back without later mutations when an existing-user mutation fails', async () => {
    // Given
    databaseQueries.length = 0;
    failedStatement.value = 'update miracon.admin_users';

    // When
    const operation = provisionSingletonAdmin({
      databaseUrl: 'postgres://runtime-database',
      email: 'editor@miracon.test',
      password: 'x'.repeat(16),
      operation: { kind: 'rotate-editor', adminId: 2 },
    });

    // Then
    await expect(operation).rejects.toThrow('database failure');
    expect(databaseQueries).toEqual([
      'begin',
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      'select id from miracon.admin_sessions where admin_user_id = $1 order by id for update',
      'update miracon.admin_users set email = $2, password_hash = $3 where id = $1',
      'rollback',
    ]);
    failedStatement.value = '';
  });
});
