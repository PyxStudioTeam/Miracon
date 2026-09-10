import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '../src/pages/api/auth/login';
import {
  clearSessionCookie,
  createSessionCookie,
  SESSION_COOKIE_NAME,
} from '../src/lib/server/auth/cookie';
import { verifySameOriginMutation } from '../src/lib/server/auth/request-security';
import { trustedClientAddress } from '../src/lib/server/api';

const authentication = vi.hoisted(() => vi.fn());
const databasePool = vi.hoisted(() => ({ marker: 'login-route-database' }));
const getDatabasePool = vi.hoisted(() => vi.fn(() => databasePool));

vi.mock('../src/lib/server/auth/login', () => ({
  authenticateAdminAndCreateSession: authentication,
}));

vi.mock('../src/lib/server/database', () => ({
  getDatabasePool,
}));

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

describe('login route contract', () => {
  const siteOrigin = 'https://miracon.gr';

  beforeEach(() => {
    vi.stubEnv('PUBLIC_SITE_URL', siteOrigin);
    getDatabasePool.mockClear();
    authentication.mockResolvedValue({
      ok: true,
      adminUserId: 1,
      role: 'owner',
      session: {
        id: 'session-id',
        sessionToken: 'opaque-session-token',
        csrfToken: 'csrf-token',
        expiresAt: new Date('2026-09-05T12:00:00.000Z'),
      },
    });
  });

  afterEach(() => {
    authentication.mockReset();
  });

  it('preserves the valid login response and session cookie contract', async () => {
    // Given
    const body = JSON.stringify({ email: 'admin@miracon.gr', password: 'correct horse battery staple' });

    // When
    const response = await login(loginContext(body, { 'content-length': String(Buffer.byteLength(body)) }));

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt: '2026-09-05T12:00:00.000Z',
    });
    expect(response.headers.get('set-cookie')).toBe(
      '__Host-session=opaque-session-token; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(authentication).toHaveBeenCalledOnce();
    expect(authentication.mock.calls[0]?.[0]).toBe(databasePool);
    expect(getDatabasePool).toHaveBeenCalledOnce();
  });

  it('preserves generic invalid credentials for schema-invalid JSON', async () => {
    // Given
    const body = JSON.stringify({ email: 'not-an-email', password: '' });
    const request = loginContext(body, { 'content-length': String(Buffer.byteLength(body)) });

    // When
    const response = await login(request);

    // Then
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_credentials', message: 'Invalid email or password' },
    });
    expectNoAuthComputation();
  });

  it('accepts a valid JSON login body at exactly 8,192 UTF-8 bytes', async () => {
    // Given
    const body = sizedLoginBody(8_192);

    // When
    const response = await login(loginContext(body, { 'content-length': '8192' }));

    // Then
    expect(response.status).toBe(200);
    expect(authentication).toHaveBeenCalledOnce();
  });

  it('rejects a declared 8,193-byte body before authentication', async () => {
    // Given
    const body = sizedLoginBody(8_193);

    // When
    const response = await login(loginContext(body, { 'content-length': '8193' }));

    // Then
    await expectLoginError(response, 413, 'invalid_request', 'Request body exceeds the login limit');
    expectNoAuthComputation();
  });

  it('requires a body length when the request is not chunked', async () => {
    // Given
    const body = JSON.stringify({ email: 'admin@miracon.gr', password: 'password' });

    // When
    const response = await login(loginContext(body, {}));

    // Then
    await expectLoginError(response, 411, 'invalid_request', 'Content-Length is required');
    expectNoAuthComputation();
  });

  it.each(['invalid', '-1', '8192.0'])('rejects invalid Content-Length %s before authentication', async (contentLength: string) => {
    // Given
    const body = JSON.stringify({ email: 'admin@miracon.gr', password: 'password' });

    // When
    const response = await login(loginContext(body, { 'content-length': contentLength }));

    // Then
    await expectLoginError(response, 400, 'invalid_request', 'Content-Length must be a decimal byte count');
    expectNoAuthComputation();
  });

  it('rejects a false-small Content-Length when the streamed body exceeds 8,192 bytes', async () => {
    // Given
    const body = new TextEncoder().encode(sizedLoginBody(8_193));

    // When
    const response = await login(streamedLoginContext([body.subarray(0, 8_192), body.subarray(8_192)], {
      'content-length': '1',
    }));

    // Then
    await expectLoginError(response, 413, 'invalid_request', 'Request body exceeds the login limit');
    expectNoAuthComputation();
  });

  it('rejects malformed JSON before authentication', async () => {
    // Given
    const body = '{';

    // When
    const response = await login(loginContext(body, { 'content-length': '1' }));

    // Then
    await expectLoginError(response, 400, 'invalid_request', 'Request body must be valid JSON');
    expectNoAuthComputation();
  });

  it('rejects invalid UTF-8 before authentication', async () => {
    // Given
    const prefix = new TextEncoder().encode('{"email":"admin@miracon.gr","password":"password","padding":"');
    const suffix = new TextEncoder().encode('"}');
    const body = new Uint8Array(prefix.length + 1 + suffix.length);
    body.set(prefix);
    body[prefix.length] = 0xff;
    body.set(suffix, prefix.length + 1);

    // When
    const response = await login(streamedLoginContext([body], { 'content-length': String(body.byteLength) }));

    // Then
    await expectLoginError(response, 400, 'invalid_request', 'Request body must be valid JSON');
    expectNoAuthComputation();
  });

  it('rejects an oversized chunked body before authentication', async () => {
    // Given
    const body = new TextEncoder().encode(sizedLoginBody(8_193));

    // When
    const response = await login(streamedLoginContext([body.subarray(0, 4_096), body.subarray(4_096)], {
      'transfer-encoding': 'chunked',
    }));

    // Then
    await expectLoginError(response, 413, 'invalid_request', 'Request body exceeds the login limit');
    expectNoAuthComputation();
  });

  function loginContext(body: BodyInit, headers: Readonly<Record<string, string>>) {
    return {
      request: new Request(`${siteOrigin}/api/auth/login`, {
        method: 'POST',
        headers: { origin: siteOrigin, 'content-type': 'application/json', ...headers },
        body,
      }),
      params: {},
      clientAddress: '198.51.100.20',
    };
  }

  function streamedLoginContext(chunks: readonly Uint8Array[], headers: Readonly<Record<string, string>>) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const init = {
      method: 'POST',
      headers: { origin: siteOrigin, 'content-type': 'application/json', ...headers },
      body,
      duplex: 'half' as const,
    };
    return {
      request: new Request(`${siteOrigin}/api/auth/login`, init),
      params: {},
      clientAddress: '198.51.100.20',
    };
  }

  function sizedLoginBody(byteLength: number): string {
    const prefix = '{"email":"admin@miracon.gr","password":"password","padding":"';
    const suffix = '"}';
    return `${prefix}${'a'.repeat(byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
  }

  async function expectLoginError(
    response: Response,
    status: number,
    code: string,
    message: string,
  ): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message } });
  }

  function expectNoAuthComputation(): void {
    expect(getDatabasePool).not.toHaveBeenCalled();
    expect(authentication).not.toHaveBeenCalled();
  }
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
    vi.stubEnv('NODE_ENV', 'production');
    expect(verifySameOriginMutation('POST', 'https://miracon.gr', 'http://miracon.gr/login', 'https://miracon.gr')).toBe(true);
    expect(verifySameOriginMutation('POST', 'http://miracon.gr', 'http://miracon.gr/login', 'https://miracon.gr')).toBe(false);
  });

  it('resolves the canonical origin from server configuration at request time', () => {
    // Given
    vi.stubEnv('NODE_ENV', 'production');
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
