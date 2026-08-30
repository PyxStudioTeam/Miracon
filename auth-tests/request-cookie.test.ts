import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionCookie,
  createSessionCookie,
  SESSION_COOKIE_NAME,
} from '../src/lib/server/auth/cookie';
import { verifySameOriginMutation } from '../src/lib/server/auth/request-security';
import { trustedClientAddress } from '../src/lib/server/api';

describe('session cookie', () => {
  it('creates a host-only secure session cookie', () => {
    expect(SESSION_COOKIE_NAME).toBe('__Host-session');
    expect(createSessionCookie('opaque-token', 900)).toBe(
      '__Host-session=opaque-token; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('clears the cookie with the same security scope', () => {
    expect(clearSessionCookie()).toBe(
      '__Host-session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });
});

describe('login client address', () => {
  it('uses the adapter address and ignores X-Forwarded-For without it', () => {
    expect(trustedClientAddress('198.51.100.1')).toBe('198.51.100.1');
    expect(trustedClientAddress()).toBe('unknown');
  });
});

describe('same-origin mutation verification', () => {
  const siteOrigin = 'https://miracon.gr';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('accepts a same-origin %s request', (method) => {
    expect(verifySameOriginMutation(method, siteOrigin, `${siteOrigin}/ignored`, siteOrigin)).toBe(true);
  });

  it('rejects missing, malformed, and cross-origin mutation origins', () => {
    expect(verifySameOriginMutation('POST', null, siteOrigin, siteOrigin)).toBe(false);
    expect(verifySameOriginMutation('POST', 'not a url', siteOrigin, siteOrigin)).toBe(false);
    expect(verifySameOriginMutation('POST', 'https://evil.example', siteOrigin, siteOrigin)).toBe(false);
  });

  it('does not require Origin for safe methods', () => {
    expect(verifySameOriginMutation('GET', null, siteOrigin)).toBe(true);
    expect(verifySameOriginMutation('HEAD', null, siteOrigin)).toBe(true);
  });

  it('prefers the configured canonical origin over the internal request URL', () => {
    expect(verifySameOriginMutation('POST', 'https://miracon.gr', 'http://miracon.gr/login', 'https://miracon.gr')).toBe(true);
    expect(verifySameOriginMutation('POST', 'http://miracon.gr', 'http://miracon.gr/login', 'https://miracon.gr')).toBe(false);
  });

  it('resolves the canonical origin from server configuration at request time', () => {
    // Given
    vi.stubEnv('PUBLIC_SITE_URL', siteOrigin);

    // When
    const canonicalRequest = verifySameOriginMutation('POST', siteOrigin, 'http://127.0.0.1:4321/login');
    const internalRequest = verifySameOriginMutation('POST', 'http://127.0.0.1:4321', 'http://127.0.0.1:4321/login');

    // Then
    expect(canonicalRequest).toBe(true);
    expect(internalRequest).toBe(false);
  });

  it('rejects non-HTTP(S) origins and fails closed on malformed configuration', () => {
    expect(verifySameOriginMutation('POST', 'ftp://miracon.gr', siteOrigin, siteOrigin)).toBe(false);
    expect(verifySameOriginMutation('POST', 'https://miracon.gr', 'http://miracon.gr/login', 'not a url')).toBe(false);
    expect(verifySameOriginMutation('POST', 'https://miracon.gr', 'http://miracon.gr/login', 'ftp://miracon.gr')).toBe(false);
  });

  it('fails closed when no canonical URL is configured', () => {
    expect(verifySameOriginMutation('POST', 'http://miracon.gr', 'http://miracon.gr/login', '')).toBe(false);
    expect(verifySameOriginMutation('POST', 'http://miracon.gr', 'http://miracon.gr/login', '   ')).toBe(false);
  });
});
