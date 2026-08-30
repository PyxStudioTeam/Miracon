import { z } from 'zod';
import type { AdminRole } from './auth/admin-role';
import type { AuthDatabase, AuthPool } from './auth/database';
import { hashPassword } from './auth/password';

export const MINIMUM_ADMIN_PASSWORD_LENGTH = 16;

export class UserManagementError extends Error {
  readonly name = 'UserManagementError';
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export type AdminUserSummary = {
  readonly id: number;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
};

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

const adminUserRowSchema = z.object({
  id: z.coerce.number().int().positive(),
  email: z.string().min(1),
  role: z.enum(['owner', 'editor']),
  is_active: z.boolean(),
  created_at: z.coerce.date(),
  last_seen_at: z.coerce.date().nullable(),
});

export function validateAdminPassword(password: string): void {
  const nonWhitespaceLength = [...password].filter((c) => !/\s/u.test(c)).length;
  if (nonWhitespaceLength < MINIMUM_ADMIN_PASSWORD_LENGTH) {
    throw new UserManagementError(
      'invalid_password',
      `Password must contain at least ${MINIMUM_ADMIN_PASSWORD_LENGTH} non-whitespace characters`,
    );
  }
}

export function validateAdminEmail(email: string): string {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    throw new UserManagementError('invalid_email', 'A valid email address is required');
  }
  return parsed.data;
}

export async function listAdminUsers(database: AuthDatabase): Promise<AdminUserSummary[]> {
  const result = await database.query(`/* users:list */
    select admin.id, admin.email, admin.role::text as role, admin.is_active, admin.created_at,
           max(session.last_seen_at) as last_seen_at
    from miracon.admin_users as admin
    left join miracon.admin_sessions as session on session.admin_user_id = admin.id
    group by admin.id, admin.email, admin.role, admin.is_active, admin.created_at
    order by admin.id asc
  `);

  return result.rows.map((row) => {
    const parsed = adminUserRowSchema.parse(row);
    return {
      id: parsed.id,
      email: parsed.email,
      role: parsed.role,
      isActive: parsed.is_active,
      createdAt: parsed.created_at.toISOString(),
      lastSeenAt: parsed.last_seen_at?.toISOString() ?? null,
    };
  });
}

export async function createEditorUser(
  pool: AuthPool,
  rawEmail: string,
  rawPassword: string,
): Promise<AdminUserSummary> {
  const email = validateAdminEmail(rawEmail);
  validateAdminPassword(rawPassword);
  const passwordHash = await hashPassword(rawPassword);

  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query('select id from miracon.admin_users where email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new UserManagementError('duplicate_email', 'An administrator with this email already exists');
    }
    const result = await client.query(`/* users:create-editor */
      insert into miracon.admin_users (email, password_hash, role)
      values ($1, $2, 'editor')
      returning id, email, role::text as role, is_active, created_at
    `, [email, passwordHash]);
    await client.query('commit');

    const row = result.rows[0];
    const parsed = adminUserRowSchema.parse({ ...row, last_seen_at: null });
    return {
      id: parsed.id,
      email: parsed.email,
      role: parsed.role,
      isActive: parsed.is_active,
      createdAt: parsed.created_at.toISOString(),
      lastSeenAt: null,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateUserCredentials(
  pool: AuthPool,
  adminId: number,
  rawEmail?: string,
  rawPassword?: string,
): Promise<void> {
  let normalizedEmail: string | undefined;
  if (rawEmail !== undefined) {
    normalizedEmail = validateAdminEmail(rawEmail);
  }
  let passwordHash: string | undefined;
  if (rawPassword !== undefined) {
    validateAdminPassword(rawPassword);
    passwordHash = await hashPassword(rawPassword);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query('select id, role::text as role from miracon.admin_users where id = $1 for update', [adminId]);
    if (target.rows.length === 0) {
      throw new UserManagementError('user_not_found', 'Administrator does not exist');
    }
    await client.query('select id from miracon.admin_sessions where admin_user_id = $1 order by id for update', [adminId]);

    if (normalizedEmail) {
      const duplicate = await client.query('select id from miracon.admin_users where email = $1 and id <> $2', [normalizedEmail, adminId]);
      if (duplicate.rows.length > 0) {
        throw new UserManagementError('duplicate_email', 'An administrator with this email already exists');
      }
    }

    if (normalizedEmail && passwordHash) {
      await client.query('update miracon.admin_users set email = $1, password_hash = $2 where id = $3', [normalizedEmail, passwordHash, adminId]);
    } else if (normalizedEmail) {
      await client.query('update miracon.admin_users set email = $1 where id = $2', [normalizedEmail, adminId]);
    } else if (passwordHash) {
      await client.query('update miracon.admin_users set password_hash = $1 where id = $2', [passwordHash, adminId]);
    }

    await client.query('update miracon.admin_sessions set revoked_at = clock_timestamp() where admin_user_id = $1 and revoked_at is null', [adminId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deactivateEditorUser(pool: AuthPool, adminId: number): Promise<void> {
  if (adminId === 1) {
    throw new UserManagementError('cannot_deactivate_owner', 'The owner account cannot be deactivated');
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query('select id, role::text as role from miracon.admin_users where id = $1 for update', [adminId]);
    if (target.rows.length === 0) {
      throw new UserManagementError('user_not_found', 'Administrator does not exist');
    }
    if (target.rows[0]?.['role'] !== 'editor') {
      throw new UserManagementError('cannot_deactivate_owner', 'Only editor accounts can be deactivated');
    }

    await client.query('update miracon.admin_users set is_active = false where id = $1', [adminId]);
    await client.query('update miracon.admin_sessions set revoked_at = clock_timestamp() where admin_user_id = $1 and revoked_at is null', [adminId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeUserSessions(pool: AuthPool, adminId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query('select id from miracon.admin_users where id = $1 for update', [adminId]);
    if (target.rows.length === 0) {
      throw new UserManagementError('user_not_found', 'Administrator does not exist');
    }
    await client.query('update miracon.admin_sessions set revoked_at = clock_timestamp() where admin_user_id = $1 and revoked_at is null', [adminId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
