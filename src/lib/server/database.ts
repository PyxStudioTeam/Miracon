import { Pool, type PoolClient } from 'pg';

export const DATABASE_POOL_MAX_CONNECTIONS = 10;

let databasePool: Pool | undefined;

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl?.trim()) {
    throw new DatabaseConfigurationError('DATABASE_URL is required');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: DATABASE_POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    maxUses: 7_500,
    application_name: 'miracon-web',
  });
}

export function getDatabasePool(): Pool {
  databasePool ??= createDatabasePool();
  return databasePool;
}

export async function withSnapshotTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}
