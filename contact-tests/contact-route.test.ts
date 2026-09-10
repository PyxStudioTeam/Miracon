import { describe, expect, it, vi } from 'vitest';
import {
  ContactConfigurationError,
  ContactSmtpConfigurationError,
  getContactDigestSecret,
} from '../src/lib/server/contact-config';
import { contactIdSchema, contactSubmissionSchema } from '../src/lib/server/contact-contracts';
import { ContactNotificationError } from '../src/lib/server/contact-notifications';
import { POST as submitContact, createContactPost } from '../src/pages/api/contact';
import * as challengeRoute from '../src/pages/api/contact/challenge';

const siteUrl = 'https://miracon.test';
process.env.PUBLIC_SITE_URL = siteUrl;

describe('contact route transport boundaries', () => {
  it('requires a dedicated contact digest secret of at least 32 characters', () => {
    // Given / When / Then
    expect(() => getContactDigestSecret(undefined)).toThrow(ContactConfigurationError);
    expect(() => getContactDigestSecret('too-short')).toThrow(ContactConfigurationError);
    expect(getContactDigestSecret('x'.repeat(32))).toBe('x'.repeat(32));
  });

  it('returns 411 before parsing a contact body without Content-Length', async () => {
    // Given
    const request = new Request(`${siteUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: siteUrl },
      body: '{',
    });

    // When
    const response = await submitContact({ request, params: {}, clientAddress: '203.0.113.10' });

    // Then
    expect(response.status).toBe(411);
  });

  it('returns 413 before parsing an oversized contact body', async () => {
    // Given
    const request = new Request(`${siteUrl}/api/contact`, {
      method: 'POST',
      headers: {
        'content-length': '8193',
        'content-type': 'application/json',
        origin: siteUrl,
      },
      body: '{',
    });

    // When
    const response = await submitContact({ request, params: {}, clientAddress: '203.0.113.10' });

    // Then
    expect(response.status).toBe(413);
  });

  it('returns 413 when the streamed body exceeds its declared bounded length', async () => {
    // Given
    const request = new Request(`${siteUrl}/api/contact`, {
      method: 'POST',
      headers: {
        'content-length': '1',
        'content-type': 'application/json',
        origin: siteUrl,
      },
      body: JSON.stringify({ message: 'x'.repeat(8_193) }),
    });

    // When
    const response = await submitContact({ request, params: {}, clientAddress: '203.0.113.10' });

    // Then
    expect(response.status).toBe(413);
  });

  it('exposes challenge issuance only as same-origin POST', async () => {
    // Given
    const request = new Request(`${siteUrl}/api/contact/challenge`, {
      method: 'POST',
      headers: { origin: 'https://attacker.test' },
    });

    // When
    const response = await challengeRoute.POST({ request, params: {}, clientAddress: '203.0.113.10' });

    // Then
    expect('GET' in challengeRoute).toBe(false);
    expect(response.status).toBe(403);
  });

  it('notifies only after an accepted submission and preserves the 201 response on failure', async () => {
    // Given
    const acceptedId = contactIdSchema.parse('10000000-0000-4000-8000-000000000001');
    const order: string[] = [];
    const log = vi.fn();
    const handler = createContactPost({
      submit: async () => {
        order.push('persisted');
        return { kind: 'accepted', id: acceptedId };
      },
      notify: async () => {
        order.push('notified');
        throw new ContactNotificationError('transport_failed');
      },
      logNotificationFailure: log,
    });

    // When
    const response = await handler(contactContext());

    // Then
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: acceptedId });
    expect(order).toEqual(['persisted', 'notified']);
    expect(log).toHaveBeenCalledWith({
      event: 'contact_notification_failed',
      contactId: acceptedId,
      category: 'transport_failed',
    });
  });

  it('does not notify for a non-accepted submission', async () => {
    // Given
    const notify = vi.fn();
    const handler = createContactPost({
      submit: async () => ({ kind: 'duplicate' }),
      notify,
      logNotificationFailure: vi.fn(),
    });

    // When
    const response = await handler(contactContext());

    // Then
    expect(response.status).toBe(409);
    expect(notify).not.toHaveBeenCalled();
  });

  it('contains enabled SMTP configuration errors without logging contact content', async () => {
    // Given
    const acceptedId = contactIdSchema.parse('10000000-0000-4000-8000-000000000001');
    const log = vi.fn();
    const handler = createContactPost({
      submit: async () => ({ kind: 'accepted', id: acceptedId }),
      notify: async () => {
        throw new ContactSmtpConfigurationError();
      },
      logNotificationFailure: log,
    });

    // When
    const response = await handler(contactContext());

    // Then
    expect(response.status).toBe(201);
    expect(log).toHaveBeenCalledWith({
      event: 'contact_notification_failed',
      contactId: acceptedId,
      category: 'configuration_invalid',
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Ada|property|example\.test|203\.0\.113/iu);
  });

  it('contains unexpected notifier failures after acceptance', async () => {
    // Given
    const acceptedId = contactIdSchema.parse('10000000-0000-4000-8000-000000000001');
    const log = vi.fn();
    const handler = createContactPost({
      submit: async () => ({ kind: 'accepted', id: acceptedId }),
      notify: async () => {
        throw new TypeError('provider detail must not escape');
      },
      logNotificationFailure: log,
    });

    // When
    const response = await handler(contactContext());

    // Then
    expect(response.status).toBe(201);
    expect(log).toHaveBeenCalledWith({
      event: 'contact_notification_failed',
      contactId: acceptedId,
      category: 'unexpected',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('provider detail');
  });
});

function contactContext() {
  const submission = contactSubmissionSchema.parse({
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    message: 'Please contact me about a property.',
    consent: true,
    locale: 'en',
    sourcePath: '/projects/example',
    website: '',
    challenge: 'a'.repeat(43),
  });
  const body = JSON.stringify(submission);
  return {
    request: new Request(`${siteUrl}/api/contact`, {
      method: 'POST',
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
        origin: siteUrl,
      },
      body,
    }),
    params: {},
    clientAddress: '203.0.113.10',
  };
}
