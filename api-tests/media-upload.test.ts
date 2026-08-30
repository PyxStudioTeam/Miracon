import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAdmin } from '../src/lib/server/auth/login';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { POST as login } from '../src/pages/api/auth/login';
import { POST as uploadMedia } from '../src/pages/api/admin/media';

const databaseUrl = requireSafeDatabaseUrl();
const siteUrl = 'https://miracon.test';
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
  await provisionAdmin(pool, 'admin@miracon.test', 'correct horse battery staple');
}, 30_000);

beforeEach(() => {
  vi.stubEnv('PUBLIC_SITE_URL', siteUrl);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await pool.end();
});

describe('admin media upload request bounds', () => {
  it('rejects missing and oversized Content-Length before multipart parsing', async () => {
    // Given
    const auth = await loginAsAdmin();

    // When
    const missing = await uploadMedia(context('/api/admin/media', { method: 'POST', headers: auth }));
    const oversized = await uploadMedia(context('/api/admin/media', {
      method: 'POST',
      headers: { ...auth, 'content-length': String(52 * 1024 * 1024) },
    }));

    // Then
    expect(missing.status).toBe(411);
    expect(await missing.json()).toEqual({ error: { code: 'invalid_request', message: 'Content-Length is required' } });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: { code: 'invalid_upload', message: 'Request body exceeds the media upload limit' } });
  });
});

type AuthHeaders = {
  readonly cookie: string;
  readonly origin: string;
  readonly 'x-csrf-token': string;
};

async function loginAsAdmin(): Promise<AuthHeaders> {
  const response = await login(context('/api/auth/login', {
    method: 'POST',
    headers: { origin: siteUrl },
    body: JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' }),
  }));
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('Expected session cookie');
  const body = await response.json() as { readonly csrfToken: string };
  return { cookie: cookie.split(';', 1)[0] ?? '', origin: siteUrl, 'x-csrf-token': body.csrfToken };
}

function context(path: string, init: RequestInit = {}) {
  return { request: new Request(`${siteUrl}${path}`, init), params: {} };
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}
