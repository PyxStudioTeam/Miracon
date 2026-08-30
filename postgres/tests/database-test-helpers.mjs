import pg from 'pg';

class DatabaseTestSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseTestSafetyError';
  }
}

export function requireSafeDatabaseTestUrl() {
  const databaseUrl = process.env.DATABASE_TEST_URL;
  if (!databaseUrl) {
    throw new DatabaseTestSafetyError('DATABASE_TEST_URL is required');
  }
  if (process.env.DATABASE_TEST_ALLOW_RESET !== '1') {
    throw new DatabaseTestSafetyError('DATABASE_TEST_ALLOW_RESET=1 is required before destructive database tests');
  }

  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  const disposableName = /(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu;
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !disposableName.test(databaseName)) {
    throw new DatabaseTestSafetyError('DATABASE_TEST_URL database name must contain a test, ci, disposable, or tmp segment');
  }
  return databaseUrl;
}

export async function openClient(databaseUrl, applicationName = 'miracon-postgres-test') {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  return client;
}

export async function resetSchemas(client, databaseUrl) {
  if (databaseUrl !== requireSafeDatabaseTestUrl()) {
    throw new DatabaseTestSafetyError('Connected database does not match DATABASE_TEST_URL');
  }
  const expectedName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//u, ''));
  const connected = await client.query('select current_database() as database_name');
  if (connected.rows[0].database_name !== expectedName) {
    throw new DatabaseTestSafetyError('Connected database name does not match DATABASE_TEST_URL');
  }
  await client.query(`
    drop schema if exists miracon cascade;
    drop schema if exists miracon_meta cascade;
    drop schema if exists runner_probe cascade
  `);
}
