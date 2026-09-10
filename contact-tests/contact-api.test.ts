import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { provisionSingletonAdmin } from '../scripts/provision-admin.mjs';
import { POST as issueChallenge } from '../src/pages/api/contact/challenge';
import { POST as submitContact, createContactPost } from '../src/pages/api/contact';
import { ContactNotificationError } from '../src/lib/server/contact-notifications';
import { GET as listContacts } from '../src/pages/api/admin/contacts/index';
import { DELETE as deleteContact, GET as getContact } from '../src/pages/api/admin/contacts/[id]';
import { POST as login } from '../src/pages/api/auth/login';

const databaseUrl = requireSafeDatabaseUrl();
const siteUrl = 'https://miracon.test';
const clientAddress = '203.0.113.40';
const digestSecret = 'contact-api-test-secret-at-least-thirty-two-bytes';
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
process.env.DATABASE_URL = databaseUrl;
process.env.PUBLIC_SITE_URL = siteUrl;
process.env.CONTACT_DIGEST_SECRET = digestSecret;

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
  await provisionSingletonAdmin({ databaseUrl, email: 'owner@miracon.test', password: 'owner password long enough' });
  await provisionSingletonAdmin({
    databaseUrl,
    email: 'editor@miracon.test',
    password: 'editor password long enough',
    operation: { kind: 'provision-editor', email: 'editor@miracon.test' },
  });
});

beforeEach(async () => {
  await pool.query('truncate miracon.contact_submissions, miracon.contact_challenges; delete from miracon.admin_sessions');
});

afterAll(async () => {
  await pool.end();
});

describe('contact API', () => {
  it('accepts a dwelled challenge once and never stores the raw client address', async () => {
    // Given
    const challengeResponse = await issueChallenge(context('/api/contact/challenge', {
      method: 'POST', headers: { origin: siteUrl, 'x-forwarded-for': '198.51.100.200' },
    }));
    const challenge = await challengeResponse.json() as { readonly challenge: string };
    await pool.query(`
      update miracon.contact_challenges
      set created_at = now() - interval '10 seconds', not_before = now() - interval '1 second'
    `);
    // When
    const accepted = await submitContact(contactRequest(challenge.challenge));
    const replayed = await submitContact(contactRequest(challenge.challenge));
    const stored = await pool.query(`
      select name, email, phone, message, locale, source_path,
        client_digest,
        octet_length(client_digest) as client_digest_bytes,
        octet_length(duplicate_digest) as duplicate_digest_bytes
      from miracon.contact_submissions
    `);

    // Then
    expect(accepted.status).toBe(201);
    expect(replayed.status).toBe(400);
    expect(stored.rows).toEqual([expect.objectContaining({
      name: 'Ada Lovelace',
      client_digest: createHmac('sha256', digestSecret)
        .update(`miracon-contact/client/v1\0${clientAddress}`, 'utf8')
        .digest(),
      client_digest_bytes: 32,
      duplicate_digest_bytes: 32,
    })]);
    expect(JSON.stringify(stored.rows)).not.toContain(clientAddress);
  });

  it('keeps the accepted row and 201 response when notification delivery fails', async () => {
    // Given
    const challenge = await newChallenge(true);
    const handler = createContactPost({
      notify: async () => {
        throw new ContactNotificationError('transport_failed');
      },
      logNotificationFailure: () => undefined,
    });

    // When
    const response = await handler(contactRequest(challenge));
    const stored = await pool.query('select id from miracon.contact_submissions');

    // Then
    expect(response.status).toBe(201);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toEqual(await response.json());
  });

  it('rejects too-fast, cross-origin, honeypot, duplicate, and hourly-limit submissions', async () => {
    // Given
    const challenge = await newChallenge(false);

    // When / Then
    expect((await submitContact(contactRequest(challenge))).status).toBe(429);
    expect((await submitContact(contactRequest(challenge, { origin: 'https://attacker.test' }))).status).toBe(403);

    const honeypotChallenge = await newChallenge(true);
    expect((await submitContact(contactRequest(honeypotChallenge, { website: 'filled' }))).status).toBe(400);

    const acceptedChallenge = await newChallenge(true);
    expect((await submitContact(contactRequest(acceptedChallenge))).status).toBe(201);
    const duplicateChallenge = await newChallenge(true);
    expect((await submitContact(contactRequest(duplicateChallenge))).status).toBe(409);

    await pool.query('update miracon.contact_submissions set duplicate_digest = decode(repeat(\'ab\', 32), \'hex\')');
    for (let index = 1; index < 5; index += 1) {
      const nextChallenge = await newChallenge(true);
      const response = await submitContact(contactRequest(nextChallenge, { message: `Unique message ${index}` }));
      expect(response.status).toBe(201);
    }
    const limitedChallenge = await newChallenge(true);
    expect((await submitContact(contactRequest(limitedChallenge, { message: 'Over the limit' }))).status).toBe(429);
  });

  it('allows an editor to list, view, and delete contacts without exposing abuse digests', async () => {
    // Given
    const challenge = await newChallenge(true);
    const created = await submitContact(contactRequest(challenge));
    const createdBody = await created.json() as { readonly id: string };
    const auth = await loginAs('editor@miracon.test', 'editor password long enough');

    // When
    const listed = await listContacts(context('/api/admin/contacts', { headers: { cookie: auth.cookie } }));
    const detail = await getContact(context(`/api/admin/contacts/${createdBody.id}`, {
      headers: { cookie: auth.cookie },
    }, { id: createdBody.id }));
    const deleted = await deleteContact(context(`/api/admin/contacts/${createdBody.id}`, {
      method: 'DELETE',
      headers: { cookie: auth.cookie, origin: siteUrl, 'x-csrf-token': auth.csrfToken },
    }, { id: createdBody.id }));

    // Then
    expect(listed.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(JSON.stringify(await listed.json())).not.toMatch(/digest|clientAddress|ipAddress/iu);
    expect((await getContact(context(`/api/admin/contacts/${createdBody.id}`, {
      headers: { cookie: auth.cookie },
    }, { id: createdBody.id }))).status).toBe(404);
  });
});

async function newChallenge(dwelled: boolean): Promise<string> {
  await pool.query(`update miracon.contact_challenges set created_at = created_at - interval '4 seconds'`);
  const response = await issueChallenge(context('/api/contact/challenge', {
    method: 'POST', headers: { origin: siteUrl },
  }));
  const body = await response.json() as { readonly challenge: string };
  if (dwelled) {
    await pool.query(
      `update miracon.contact_challenges
       set created_at = now() - interval '10 seconds', not_before = now() - interval '1 second'
       where token_digest = $1`,
      [createHmac('sha256', digestSecret)
        .update(`miracon-contact/challenge/v1\0${body.challenge}`, 'utf8')
        .digest()],
    );
  }
  return body.challenge;
}

function contactRequest(challenge: string, overrides: Readonly<Record<string, string>> = {}) {
  const body = JSON.stringify({
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    phone: '+30 210 000 0000',
    message: overrides.message ?? 'Please contact me about a property.',
    consent: true,
    locale: 'en',
    sourcePath: '/projects/example',
    website: overrides.website ?? '',
    challenge,
  });
  return context('/api/contact', {
    method: 'POST',
    headers: {
      'content-length': String(Buffer.byteLength(body)),
      'content-type': 'application/json',
      origin: overrides.origin ?? siteUrl,
      'x-forwarded-for': '198.51.100.200',
    },
    body,
  });
}

function context(path: string, init: RequestInit = {}, params: Readonly<Record<string, string>> = {}) {
  return { request: new Request(`${siteUrl}${path}`, init), params, clientAddress };
}

async function loginAs(email: string, password: string): Promise<{ readonly cookie: string; readonly csrfToken: string }> {
  const credentials = JSON.stringify({ email, password });
  const response = await login(context('/api/auth/login', {
    method: 'POST',
    headers: { origin: siteUrl, 'content-length': String(Buffer.byteLength(credentials)) },
    body: credentials,
  }));
  const body = await response.json() as { readonly csrfToken: string };
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Expected administrator session cookie');
  return { cookie, csrfToken: body.csrfToken };
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}
