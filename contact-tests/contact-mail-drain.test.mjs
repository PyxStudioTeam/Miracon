import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'libpg-query';
import {
  claimContactMailJob,
  completeContactMailJob,
  drainContactMail,
  runContactMailDrainCli,
} from '../scripts/contact-mail-drain.mjs';
import { getContactMailConfig } from '../scripts/contact-mail-delivery.mjs';

const id = '8c35acae-191e-4cb3-b398-423296ec9321';
const createdAt = new Date('2026-10-01T10:00:00.000Z');
const config = getContactMailConfig({
  CONTACT_SMTP_ENABLED: 'true', CONTACT_SMTP_HOST: 'mail.example.org', CONTACT_SMTP_PORT: '465',
  CONTACT_SMTP_USER: 'sender', CONTACT_SMTP_PASSWORD: 'not-a-real-password',
  CONTACT_SMTP_FROM: 'inbox@example.org', CONTACT_SMTP_TO: 'owner@example.org',
});
const contact = {
  id, name: 'Test Customer', email: 'customer@example.net', phone: '+30 210 000 0000',
  message: 'Never log this secret text', locale: 'en', source_path: '/contact', contact_created_at: createdAt,
};

function fixtureDatabase(kinds) {
  const jobs = kinds.map((kind) => ({
    ...contact, contact_id: id, kind, state: 'queued', attempts: 0, created_at: createdAt,
    next_attempt_at: createdAt, lease_token: null, lease_expires_at: null, last_failure_category: null,
  }));
  const parsedQueries = new Set();
  return {
    jobs,
    async query(sql, values) {
      if (!parsedQueries.has(sql)) {
        await parse(sql);
        parsedQueries.add(sql);
      }
      if (sql.includes('with candidate as (')) {
        const [now, token, expires] = values;
        assert.equal(expires.getTime() - now.getTime(), 60_000);
        const job = jobs.find((entry) =>
          entry.state === 'queued' && entry.next_attempt_at <= now
          || entry.state === 'leased' && entry.lease_expires_at <= now);
        if (!job) return { rows: [] };
        const ageMs = job.kind === 'ack' ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
        if (job.attempts >= 10 || now.getTime() - job.created_at.getTime() >= ageMs) {
          job.state = 'dead';
          job.last_failure_category = job.attempts >= 10 ? 'max_attempts' : 'expired';
          job.lease_token = null;
          job.lease_expires_at = null;
        } else {
          job.state = 'leased';
          job.attempts++;
          job.lease_token = token;
          job.lease_expires_at = expires;
        }
        return { rows: [job] };
      }
      if (sql.includes('update miracon.contact_mail_jobs')) {
        const [contactId, kind, now, state, nextAttempt, category, token] = values;
        const job = jobs.find((entry) => entry.contact_id === contactId && entry.kind === kind);
        if (job.state !== 'leased' || job.lease_token !== token || job.lease_expires_at <= now) {
          return { rowCount: 0 };
        }
        job.state = state;
        job.next_attempt_at = nextAttempt ?? job.next_attempt_at;
        job.last_failure_category = category;
        job.sent_at = state === 'sent' ? now : null;
        job.lease_token = null;
        job.lease_expires_at = null;
        return { rowCount: 1 };
      }
      if (sql.includes('select count(*)')) {
        return { rows: [{ count: jobs.filter((job) =>
          job.state === 'queued' && job.next_attempt_at <= values[0]
          || job.state === 'leased' && job.lease_expires_at <= values[0]).length }] };
      }
      throw new Error('Unexpected query');
    },
    async end() {},
  };
}

test('dry-run counts eligible queued and expired leases but never constructs an SMTP transport', async () => {
  const database = fixtureDatabase(['team', 'ack']);
  let transportCreated = false;
  const result = await runContactMailDrainCli([], { DATABASE_URL: 'postgresql://test-host/fake' }, {
    createPool: () => database,
    createTransport: () => { transportCreated = true; throw new Error('must not send'); },
    now: () => createdAt,
  });
  assert.deepEqual(result, { dryRun: true, candidates: 2 });
  assert.equal(transportCreated, false);
  assert.equal(database.jobs.every((job) => job.state === 'queued'), true);
  await assert.rejects(runContactMailDrainCli(['--apply'], { DATABASE_URL: 'postgresql://test-host/fake' }, {
    createPool: () => database,
  }), { name: 'ContactMailConfigurationError' });
  await assert.rejects(runContactMailDrainCli(['--apply'], { CONTACT_SMTP_ENABLED: 'true' }),
    { message: 'DATABASE_URL is required' });
});

test('explicit apply uses configured SMTP transport, sends and closes database and transport', async () => {
  const database = fixtureDatabase(['team']);
  let closedTransport = 0;
  let closedDatabase = 0;
  const messages = [];
  database.end = async () => { closedDatabase++; };
  const environment = {
    DATABASE_URL: 'postgresql://test-host/fake',
    CONTACT_SMTP_ENABLED: 'true',
    CONTACT_SMTP_HOST: 'mail.example.org', CONTACT_SMTP_PORT: '465',
    CONTACT_SMTP_USER: 'sender', CONTACT_SMTP_PASSWORD: 'not-a-real-password',
    CONTACT_SMTP_FROM: 'inbox@example.org', CONTACT_SMTP_TO: 'owner@example.org',
  };
  const result = await runContactMailDrainCli(['--apply'], environment, {
    createPool: () => database,
    createTransport: () => ({
      async send(message) { messages.push(message); return { acceptedCount: 1, rejectedCount: 0 }; },
      close() { closedTransport++; },
    }),
    log: () => {},
    now: () => createdAt,
  });
  assert.deepEqual(result, { dryRun: false, sent: 1, queued: 0, dead: 0, leaseLost: 0 });
  assert.equal(messages[0].to, 'owner@example.org');
  assert.equal(closedTransport, 1);
  assert.equal(closedDatabase, 1);
});

test('both independent jobs process, rejected ack backs off and retries without re-sending team mail', async () => {
  const database = fixtureDatabase(['team', 'ack']);
  let currentTime = new Date(createdAt.getTime() + 1_000);
  const sent = [];
  const events = [];
  let rejectAck = true;
  const transport = { async send(message) {
    sent.push(message);
    if (message.to === contact.email && rejectAck) return { acceptedCount: 0, rejectedCount: 1 };
    return { acceptedCount: 1, rejectedCount: 0 };
  } };
  const run = () => drainContactMail({ database, config, transport, now: () => currentTime, log: (event) => events.push(event) });
  assert.deepEqual(await run(), { dryRun: false, sent: 1, queued: 1, dead: 0, leaseLost: 0 });
  assert.equal(database.jobs.find((job) => job.kind === 'ack').next_attempt_at.getTime(), currentTime.getTime() + 60_000);
  assert.equal(sent.length, 2);
  assert.deepEqual(await run(), { dryRun: false, sent: 0, queued: 0, dead: 0, leaseLost: 0 });
  currentTime = new Date(currentTime.getTime() + 60_000);
  rejectAck = false;
  assert.deepEqual(await run(), { dryRun: false, sent: 1, queued: 0, dead: 0, leaseLost: 0 });
  assert.equal(database.jobs.find((job) => job.kind === 'team').attempts, 1);
  assert.equal(database.jobs.find((job) => job.kind === 'ack').attempts, 2);
  assert.equal(sent.length, 3);
  assert.equal(events.every((event) => Object.keys(event).sort().join(',') === 'category,id,kind'
    && !JSON.stringify(event).includes(contact.message)), true);
});

test('expired lease is reclaimed with a new token; stale sender cannot finalize it', async () => {
  const database = fixtureDatabase(['team']);
  const first = await claimContactMailJob(database, createdAt);
  assert.equal(first.attempts, 1);
  const secondTime = new Date(createdAt.getTime() + 60_000);
  const second = await claimContactMailJob(database, secondTime);
  assert.equal(second.attempts, 2);
  assert.notEqual(first.leaseToken, second.leaseToken);
  assert.equal(await completeContactMailJob(database, first, secondTime), 'lease_lost');
  const retryTime = new Date(secondTime.getTime() + 10_000);
  assert.equal(await completeContactMailJob(database, second, retryTime, 'transport_failed'), 'queued');
  assert.equal(database.jobs[0].next_attempt_at.getTime(), retryTime.getTime() + 120_000);
});

test('retry delay caps at one hour and team jobs expire at seven days', async () => {
  const database = fixtureDatabase(['team']);
  database.jobs[0].attempts = 7;
  const now = new Date(createdAt.getTime() + 1_000);
  const claimed = await claimContactMailJob(database, now);
  assert.equal(claimed.attempts, 8);
  assert.equal(await completeContactMailJob(database, claimed, now, 'transport_failed'), 'queued');
  assert.equal(database.jobs[0].next_attempt_at.getTime(), now.getTime() + 60 * 60_000);
  const expiry = new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000);
  const events = [];
  const result = await drainContactMail({
    database, config, now: () => expiry,
    transport: { async send() { throw new Error('Expired mail must not be sent'); } },
    log: (event) => events.push(event),
  });
  assert.deepEqual(result, { dryRun: false, sent: 0, queued: 0, dead: 1, leaseLost: 0 });
  assert.deepEqual(events, [{ id, kind: 'team', category: 'expired' }]);
});

test('stale jobs expire before send and ten failures become terminal', async () => {
  const database = fixtureDatabase(['ack', 'team']);
  const transport = { async send() { throw new Error('must not send'); } };
  let now = new Date(createdAt.getTime() + 24 * 60 * 60_000);
  assert.deepEqual(await drainContactMail({ database, config, now: () => now, transport }),
    { dryRun: false, sent: 0, queued: 1, dead: 1, leaseLost: 0 });
  assert.equal(database.jobs.find((job) => job.kind === 'ack').last_failure_category, 'expired');
  const team = database.jobs.find((job) => job.kind === 'team');
  team.state = 'queued';
  team.next_attempt_at = now;
  team.attempts = 9;
  now = new Date(now.getTime() + 1_000);
  assert.deepEqual(await drainContactMail({ database, config, now: () => now, transport }),
    { dryRun: false, sent: 0, queued: 0, dead: 1, leaseLost: 0 });
  assert.equal(team.attempts, 10);
  assert.equal(team.last_failure_category, 'transport_failed');
});
