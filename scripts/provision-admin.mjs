import { fileURLToPath } from 'node:url';
import { argon2id, hash } from 'argon2';
import pg from 'pg';

const minimumPasswordLength = 16;
const argon2Options = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export class AdminProvisioningError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminProvisioningError';
  }
}

/**
 * @typedef {{ readonly kind: 'provision-owner' | 'provision-editor' | 'rotate-owner' | 'rotate-editor' | 'deactivate-editor' | 'revoke-sessions', readonly adminId?: number, readonly email?: string }} AdminLifecycleOperation
 */

const usageError = () => new AdminProvisioningError(
  'Use --email=ADDRESS and --password-stdin to provision an owner, --role=editor to provision an editor, --rotate to replace credentials, --deactivate --admin-id=N, or --revoke-sessions --admin-id=N',
);

function parseAdminId(value) {
  if (!/^[1-9]\d*$/u.test(value)) throw usageError();
  const adminId = Number(value);
  if (!Number.isSafeInteger(adminId)) throw usageError();
  return adminId;
}

function requireCredentials(values, passwordFromStdin) {
  const email = values.get('email');
  if (!email || !passwordFromStdin) throw usageError();
  return email;
}

/**
 * Parses the supported administrator lifecycle CLI into one explicit operation.
 * @param {readonly string[]} argumentsList
 * @returns {AdminLifecycleOperation}
 */
export function parseProvisioningArguments(argumentsList) {
  const values = new Map();
  const flags = new Set();
  for (const argument of argumentsList) {
    if (['--rotate', '--deactivate', '--revoke-sessions', '--password-stdin'].includes(argument)) {
      if (flags.has(argument)) throw usageError();
      flags.add(argument);
      continue;
    }
    const match = /^--(email|role|admin-id)=(.*)$/u.exec(argument);
    if (!match || values.has(match[1])) throw usageError();
    values.set(match[1], match[2]);
  }

  const operationFlags = ['--rotate', '--deactivate', '--revoke-sessions'].filter((flag) => flags.has(flag));
  if (operationFlags.length > 1) throw usageError();
  const adminIdValue = values.get('admin-id');
  const adminId = adminIdValue === undefined ? undefined : parseAdminId(adminIdValue);
  const role = values.get('role');
  const passwordFromStdin = flags.has('--password-stdin');
  const operationFlag = operationFlags[0];

  if (operationFlag === '--deactivate' || operationFlag === '--revoke-sessions') {
    if (role !== undefined || values.has('email') || passwordFromStdin || adminId === undefined) throw usageError();
    if (operationFlag === '--deactivate' && adminId === 1) {
      throw new AdminProvisioningError('The owner cannot be deactivated');
    }
    return operationFlag === '--deactivate'
      ? { kind: 'deactivate-editor', adminId }
      : { kind: 'revoke-sessions', adminId };
  }

  if (operationFlag === '--rotate') {
    if (role !== undefined) throw usageError();
    const email = requireCredentials(values, passwordFromStdin);
    if (adminId === undefined) return { kind: 'rotate-owner', email };
    if (adminId === 1) throw new AdminProvisioningError('Use owner rotation without --admin-id');
    return { kind: 'rotate-editor', adminId, email };
  }

  if (adminId !== undefined || (role !== undefined && role !== 'editor')) throw usageError();
  const email = requireCredentials(values, passwordFromStdin);
  return role === 'editor' ? { kind: 'provision-editor', email } : { kind: 'provision-owner', email };
}

function requiresCredentials(operation) {
  return operation.kind === 'provision-owner'
    || operation.kind === 'provision-editor'
    || operation.kind === 'rotate-owner'
    || operation.kind === 'rotate-editor';
}

function legacyOperation(input) {
  return input.rotate ? { kind: 'rotate-owner' } : { kind: 'provision-owner' };
}

/**
 * Validates direct provisioner input and normalizes credential-bearing emails.
 * @param {{ readonly databaseUrl?: string, readonly email?: string, readonly password?: string, readonly rotate?: boolean, readonly operation?: AdminLifecycleOperation }} input
 */
export function validateProvisioningInput(input) {
  const operation = input.operation ?? legacyOperation(input);
  if (!input.databaseUrl?.trim()) throw new AdminProvisioningError('DATABASE_URL is required');
  if (!requiresCredentials(operation)) return { ...input, operation };
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AdminProvisioningError('A valid administrator email is required');
  }
  if (!input.password || [...input.password].filter((character) => !/\s/u.test(character)).length < minimumPasswordLength) {
    throw new AdminProvisioningError(`Administrator password must contain at least ${minimumPasswordLength} non-whitespace characters`);
  }
  return { ...input, email, operation };
}

function targetError(operation, target) {
  if (!target) return new AdminProvisioningError('The requested administrator does not exist');
  if ((target.id === 1 && target.role !== 'owner') || (target.id > 1 && target.role !== 'editor')) {
    return new AdminProvisioningError('The administrator role does not match its reserved identity');
  }
  if (operation.kind === 'rotate-owner' && (target.id !== 1 || target.role !== 'owner')) {
    return new AdminProvisioningError('The owner record is invalid');
  }
  if ((operation.kind === 'rotate-editor' || operation.kind === 'deactivate-editor')
    && (target.id === 1 || target.role !== 'editor')) {
    return new AdminProvisioningError('Editor lifecycle operations require an editor');
  }
  return null;
}

function operationAdminId(operation) {
  return operation.kind === 'rotate-owner' ? 1 : operation.adminId;
}

/**
 * Mutates an existing administrator while holding admin-user then session locks.
 * @param {{ query(statement: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly { readonly id: number, readonly role: string, readonly is_active: boolean }[] }> }} client
 * @param {{ readonly operation: AdminLifecycleOperation, readonly email?: string, readonly passwordHash?: string }} input
 */
export async function runExistingAdminLifecycle(client, input) {
  const adminId = operationAdminId(input.operation);
  if (adminId === undefined) throw new AdminProvisioningError('An administrator ID is required');
  await client.query('begin');
  try {
    const targetResult = await client.query(
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      [adminId],
    );
    await client.query('select id from miracon.admin_sessions where admin_user_id = $1 order by id for update', [adminId]);
    const error = targetError(input.operation, targetResult.rows[0]);
    if (error) throw error;
    if (input.operation.kind === 'rotate-owner' || input.operation.kind === 'rotate-editor') {
      const activeState = input.operation.kind === 'rotate-owner' ? ', is_active = true' : '';
      await client.query(
        `update miracon.admin_users set email = $2, password_hash = $3${activeState} where id = $1`,
        [adminId, input.email, input.passwordHash],
      );
    }
    if (input.operation.kind === 'deactivate-editor') {
      await client.query('update miracon.admin_users set is_active = false where id = $1', [adminId]);
    }
    await client.query(
      'update miracon.admin_sessions set revoked_at = now() where admin_user_id = $1 and revoked_at is null',
      [adminId],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * Rotates the owner credentials while retaining compatibility with existing callers.
 * @param {{ query(statement: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly { readonly id: number, readonly role: string, readonly is_active: boolean }[] }> }} client
 * @param {{ readonly email: string, readonly passwordHash: string }} credentials
 */
export function rotateSingletonAdminCredentials(client, credentials) {
  return runExistingAdminLifecycle(client, { operation: { kind: 'rotate-owner' }, ...credentials });
}

async function provisionNewAdmin(client, input) {
  await client.query('begin');
  try {
    const owner = await client.query(
      'select id, role::text as role, is_active from miracon.admin_users where id = $1 for update',
      [1],
    );
    if (input.operation.kind === 'provision-owner') {
      if (owner.rows[0]) throw new AdminProvisioningError('An administrator already exists; use --rotate to replace its credentials');
      await client.query(
        `insert into miracon.admin_users (id, email, password_hash, role)
         values (1, $1, $2, 'owner') returning id`,
        [input.email, input.passwordHash],
      );
    } else {
      const result = await client.query(
        `insert into miracon.admin_users (email, password_hash, role)
         values ($1, $2, 'editor') returning id`,
        [input.email, input.passwordHash],
      );
      if (result.rowCount !== 1 || !Number.isInteger(result.rows[0]?.id) || result.rows[0].id <= 1) {
        throw new AdminProvisioningError('Editor provisioning did not return a sequence-generated editor ID');
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * Executes owner and editor provisioning and existing-user lifecycle operations.
 * @param {{ readonly databaseUrl?: string, readonly email?: string, readonly password?: string, readonly rotate?: boolean, readonly operation?: AdminLifecycleOperation }} input
 */
export async function provisionSingletonAdmin(input) {
  const values = validateProvisioningInput(input);
  const passwordHash = requiresCredentials(values.operation) ? await hash(values.password, argon2Options) : undefined;
  const client = new pg.Client({
    connectionString: values.databaseUrl,
    application_name: 'miracon-admin-provisioning',
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  try {
    if (values.operation.kind === 'provision-owner' || values.operation.kind === 'provision-editor') {
      await provisionNewAdmin(client, { operation: values.operation, email: values.email, passwordHash });
      return;
    }
    await runExistingAdminLifecycle(client, { operation: values.operation, email: values.email, passwordHash });
  } finally {
    await client.end();
  }
}

async function main() {
  const operation = parseProvisioningArguments(process.argv.slice(2));
  let password;
  if (requiresCredentials(operation)) {
    password = '';
    for await (const chunk of process.stdin) password += chunk;
    password = password.replace(/\r?\n$/u, '');
  }
  await provisionSingletonAdmin({ databaseUrl: process.env.DATABASE_URL, email: operation.email, password, operation });
  console.log('Administrator lifecycle operation completed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Administrator lifecycle operation failed');
    process.exitCode = 1;
  });
}
