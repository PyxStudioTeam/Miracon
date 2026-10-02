import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContactMailConfigurationError,
  ContactMailDeliveryError,
  createContactMailTransport,
  deliverContactMail,
  getContactMailConfig,
  renderContactMail,
} from '../scripts/contact-mail-delivery.mjs';

const smtpEnvironment = {
  CONTACT_SMTP_ENABLED: 'true',
  CONTACT_SMTP_HOST: 'mail.example.org',
  CONTACT_SMTP_PORT: '587',
  CONTACT_SMTP_USER: 'sender',
  CONTACT_SMTP_PASSWORD: 'not-a-real-password',
  CONTACT_SMTP_FROM: '  inbox@example.org  ',
  CONTACT_SMTP_TO: 'owner@example.org',
};

const contact = {
  id: '8c35acae-191e-4cb3-b398-423296ec9321',
  name: 'Customer Name',
  email: 'customer@example.net',
  phone: '+30 210 000 0000',
  locale: 'en',
  sourcePath: '/contact',
  message: 'Private message with a unique marker: FJX96',
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
};

test('SMTP requires explicit enablement, validated fields and either implicit TLS or mandatory STARTTLS', () => {
  assert.deepEqual(getContactMailConfig({}), { kind: 'disabled' });
  assert.deepEqual(getContactMailConfig({ CONTACT_SMTP_ENABLED: 'false' }), { kind: 'disabled' });
  assert.throws(() => getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_ENABLED: 'yes' }), ContactMailConfigurationError);
  assert.throws(() => getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_PORT: '25' }), ContactMailConfigurationError);
  assert.throws(() => getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_FROM: 'unsafe\r\nBcc: outsider@example.org' }), ContactMailConfigurationError);
  assert.throws(() => getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_PASSWORD: '' }), ContactMailConfigurationError);
  const startTls = getContactMailConfig(smtpEnvironment);
  assert.deepEqual({ port: startTls.port, secure: startTls.secure, requireTls: startTls.requireTls, from: startTls.from },
    { port: 587, secure: false, requireTls: true, from: 'inbox@example.org' });
  const implicitTls = getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_PORT: '465' });
  assert.deepEqual({ port: implicitTls.port, secure: implicitTls.secure, requireTls: implicitTls.requireTls },
    { port: 465, secure: true, requireTls: false });
});

test('SMTP transport verifies certificates and requires STARTTLS on 587', async () => {
  const options = [];
  let closed = 0;
  const createTransport = (settings) => {
    options.push(settings);
    return {
      async sendMail() { return { accepted: ['one'], rejected: [] }; },
      close() { closed++; },
    };
  };
  for (const port of ['465', '587']) {
    const transport = createContactMailTransport(
      getContactMailConfig({ ...smtpEnvironment, CONTACT_SMTP_PORT: port }), createTransport,
    );
    assert.deepEqual(await transport.send({ to: 'recipient@example.net' }),
      { acceptedCount: 1, rejectedCount: 0 });
    transport.close();
  }
  assert.equal(closed, 2);
  assert.deepEqual(options.map(({ port, secure, requireTLS, ignoreTLS, tls }) =>
    ({ port, secure, requireTLS, ignoreTLS, tls })), [
    { port: 465, secure: true, requireTLS: false, ignoreTLS: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } },
    { port: 587, secure: false, requireTLS: true, ignoreTLS: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } },
  ]);
  for (const option of options) {
    assert.equal(option.connectionTimeout, 5_000);
    assert.equal(option.dnsTimeout, 5_000);
    assert.equal(option.greetingTimeout, 5_000);
    assert.equal(option.socketTimeout, 10_000);
  }
});

test('team notification includes request details and a reply address, but only the owner is addressed', () => {
  const team = renderContactMail(contact, 'team', getContactMailConfig(smtpEnvironment));
  assert.equal(team.from, 'inbox@example.org');
  assert.equal(team.to, 'owner@example.org');
  assert.equal(team.replyTo, contact.email);
  assert.match(team.text, /Private message with a unique marker: FJX96/u);
  assert.match(team.text, /Accepted at: 2026-10-01T10:00:00.000Z/u);
  assert.match(team.text, /Phone: \+30 210 000 0000/u);
  assert.equal(team.messageId, `<contact-${contact.id}-team@example.org>`);
});

test('English and Greek acknowledgements contain no submitted details or owner recipient', () => {
  const config = getContactMailConfig(smtpEnvironment);
  const english = renderContactMail(contact, 'ack', config);
  const greek = renderContactMail({ ...contact, locale: 'el' }, 'ack', config);
  for (const message of [english, greek]) {
    assert.equal(message.from, 'inbox@example.org');
    assert.equal(message.to, contact.email);
    assert.equal(message.replyTo, undefined);
    assert.equal(message.messageId, `<contact-${contact.id}-ack@example.org>`);
    assert.equal(message.headers['Auto-Submitted'], 'auto-replied');
    assert.equal(message.headers['X-Auto-Response-Suppress'], 'All');
    for (const sensitive of [contact.name, contact.message, contact.phone, contact.sourcePath, 'owner@example.org']) {
      assert.equal(message.text.includes(sensitive), false);
      assert.equal(message.subject.includes(sensitive), false);
    }
  }
  assert.match(english.text, /Thank you for contacting us/u);
  assert.match(greek.text, /Ευχαριστούμε/u);
  assert.notEqual(english.text, greek.text);
  assert.throws(() => renderContactMail({ ...contact, email: null }, 'ack', config), { category: 'invalid_recipient' });
});

test('delivery accepts exactly one recipient and categorizes ambiguous SMTP failures without leaking details', async () => {
  const config = getContactMailConfig(smtpEnvironment);
  const messages = [];
  const transport = { async send(message) { messages.push(message); return { acceptedCount: 1, rejectedCount: 0 }; } };
  await deliverContactMail(contact, 'team', config, transport);
  await deliverContactMail(contact, 'team', config, transport);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, messages[1].messageId);
  await assert.rejects(deliverContactMail(contact, 'ack', config, {
    async send() { return { acceptedCount: 0, rejectedCount: 1 }; },
  }), { category: 'recipient_rejected' });
  await assert.rejects(deliverContactMail(contact, 'ack', config, {
    async send() { throw new Error('secret smtp server reply with customer@example.net'); },
  }), (error) => error instanceof ContactMailDeliveryError
    && error.category === 'transport_failed'
    && !error.message.includes('customer@example.net'));
});
