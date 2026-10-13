import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { provisionSingletonAdmin } from '../scripts/provision-admin.mjs';
import { POST as issueChallenge } from '../src/pages/api/contact/challenge';
import { POST as submitContact } from '../src/pages/api/contact';
import { GET as listContacts } from '../src/pages/api/admin/contacts/index';
import { GET as exportContacts } from '../src/pages/api/admin/contacts/export';
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
  await pool.query('truncate miracon.contact_mail_jobs, miracon.contact_submissions, miracon.contact_challenges; delete from miracon.admin_sessions');
});

afterAll(async () => {
  await pool.end();
});

describe('contact API', () => {
  it('accepts an immediate challenge once and never stores the raw client address', async () => {
    // Given
    const challengeResponse = await issueChallenge(context('/api/contact/challenge', {
      method: 'POST', headers: { origin: siteUrl, 'x-forwarded-for': '198.51.100.200' },
    }));
    const challenge = await challengeResponse.json() as { readonly challenge: string; readonly expiresAt: string };
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
    expect(challengeResponse.status).toBe(200);
    expect(Object.keys(challenge).sort()).toEqual(['challenge', 'expiresAt']);
    expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(Date.now());
    expect(replayed.status).toBe(400);
    expect((await replayed.json()).error.code).toBe('invalid_challenge');
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

  it('atomically schedules both emails for an opted-in accepted submission', async () => {
    const previousOptIn = process.env.CONTACT_AUTOREPLY_ENABLED;
    process.env.CONTACT_AUTOREPLY_ENABLED = 'true';
    try {
      const challenge = await newChallenge();
      const response = await submitContact(contactRequest(challenge));
      expect(response.status).toBe(201);
      const { id } = await response.json() as { readonly id: string };

      const jobs = await pool.query<{ readonly contact_id: string; readonly kind: string; readonly state: string }>(
        'select contact_id, kind, state from miracon.contact_mail_jobs order by kind',
      );
      expect(jobs.rows).toEqual([
        { contact_id: id, kind: 'ack', state: 'queued' },
        { contact_id: id, kind: 'team', state: 'queued' },
      ]);
    } finally {
      if (previousOptIn === undefined) delete process.env.CONTACT_AUTOREPLY_ENABLED;
      else process.env.CONTACT_AUTOREPLY_ENABLED = previousOptIn;
    }
  });

  it('rejects cross-origin, honeypot, duplicate, and hourly-limit submissions', async () => {
    // When / Then
    expect((await issueChallenge(context('/api/contact/challenge', {
      method: 'POST', headers: { origin: 'https://attacker.test' },
    }))).status).toBe(403);
    const challenge = await newChallenge();
    expect((await submitContact(contactRequest(challenge, { origin: 'https://attacker.test' }))).status).toBe(403);

    const honeypotChallenge = await newChallenge();
    expect((await submitContact(contactRequest(honeypotChallenge, { website: 'filled' }))).status).toBe(400);

    const acceptedChallenge = await newChallenge();
    expect((await submitContact(contactRequest(acceptedChallenge))).status).toBe(201);
    const duplicateChallenge = await newChallenge();
    const duplicate = await submitContact(contactRequest(duplicateChallenge));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('duplicate_contact');

    await pool.query('update miracon.contact_submissions set duplicate_digest = decode(repeat(\'ab\', 32), \'hex\')');
    for (let index = 1; index < 5; index += 1) {
      const nextChallenge = await newChallenge();
      const response = await submitContact(contactRequest(nextChallenge, { message: `Unique message ${index}` }));
      expect(response.status).toBe(201);
    }
    const limitedChallenge = await newChallenge();
    const limited = await submitContact(contactRequest(limitedChallenge, { message: 'Over the limit' }));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('rate_limited');
  });

  it('keeps contact PII owner-only for list and detail, and deletion owner-only', async () => {
    const challenge = await newChallenge();
    const created = await submitContact(contactRequest(challenge));
    const { id } = await created.json() as { readonly id: string };
    const editor = await loginAs('editor@miracon.test', 'editor password long enough');
    const owner = await loginAs('owner@miracon.test', 'owner password long enough');

    const editorList = await listContacts(context('/api/admin/contacts', { headers: { cookie: editor.cookie } }));
    const editorDetail = await getContact(context(`/api/admin/contacts/${id}`, {
      headers: { cookie: editor.cookie },
    }, { id }));
    const editorDelete = await deleteContact(context(`/api/admin/contacts/${id}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie, origin: siteUrl, 'x-csrf-token': editor.csrfToken },
    }, { id }));
    for (const response of [editorList, editorDetail, editorDelete]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
      });
    }

    const ownerList = await listContacts(context('/api/admin/contacts', { headers: { cookie: owner.cookie } }));
    const ownerDetail = await getContact(context(`/api/admin/contacts/${id}`, {
      headers: { cookie: owner.cookie },
    }, { id }));
    expect(ownerList.status).toBe(200);
    expect(ownerDetail.status).toBe(200);
    expect((await ownerList.json()).contacts).toEqual([expect.objectContaining({ id })]);
    expect((await ownerDetail.json()).contact).toEqual(expect.objectContaining({ id }));
    const ownerDelete = await deleteContact(context(`/api/admin/contacts/${id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: siteUrl, 'x-csrf-token': owner.csrfToken },
    }, { id }));
    expect(ownerDelete.status).toBe(204);
    expect((await getContact(context(`/api/admin/contacts/${id}`, {
      headers: { cookie: owner.cookie },
    }, { id }))).status).toBe(404);
  });

  it('exports every stored request beyond the list page without spreadsheet formulas', async () => {
    await pool.query(
      `insert into miracon.contact_submissions
        (id, name, email, phone, message, consented_at, locale, source_path,
         client_digest, duplicate_digest, created_at)
       select ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         case when i = 1 then $1 else 'Person ' || i end,
         'person' || i || '@example.test', '+30 210 000 0000',
         case when i = 2 then $2 else 'Full request ' || i end,
         now(), 'en', '/projects/source',
         decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'), now()
       from generate_series(1, 101) as i`,
      [' =HYPERLINK("https://attacker.test")', '-2+3,"quoted"\nsecond line'],
    );
    const unauthenticated = await exportContacts(context('/api/admin/contacts/export'));
    expect(unauthenticated.status).toBe(401);

    const editor = await loginAs('editor@miracon.test', 'editor password long enough');
    const denied = await exportContacts(context('/api/admin/contacts/export', { headers: { cookie: editor.cookie } }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
    });
    const owner = await loginAs('owner@miracon.test', 'owner password long enough');
    const listed = await listContacts(context('/api/admin/contacts?limit=50', { headers: { cookie: owner.cookie } }));
    const csvResponse = await exportContacts(context('/api/admin/contacts/export', { headers: { cookie: owner.cookie } }));
    const csv = Buffer.from(await csvResponse.arrayBuffer()).toString('utf8');
    expect((await listed.json()).contacts).toHaveLength(50);
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(csvResponse.headers.get('content-type')).toContain('text/csv; charset=utf-8');
    expect(csv.codePointAt(0)).toBe(0xFEFF);
    expect(csv).toContain(`"' =HYPERLINK(""https://attacker.test"")"`);
    expect(csv).toContain(`"'-2+3,""quoted""\nsecond line"`);
    expect(csv).toContain('"Person 101"');
    expect(csv).toContain('"Person 50"');
    expect(csv).toContain('"/projects/source"');
    expect(csv.match(/"Person \d+"/gu)).toHaveLength(100);
  });
});

async function newChallenge(): Promise<string> {
  const response = await issueChallenge(context('/api/contact/challenge', {
    method: 'POST', headers: { origin: siteUrl },
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { readonly challenge: string };
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
