import { describe, expect, it } from 'vitest';
import {
  ContactConfigurationError,
  getContactDigestSecret,
} from '../src/lib/server/contact-config';
import { POST as submitContact } from '../src/pages/api/contact';
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

});

