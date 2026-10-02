import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as activity } from '../src/pages/api/auth/activity';
import { GET as status } from '../src/pages/api/auth/session';
import { POST as csrf } from '../src/pages/api/auth/csrf';
import { findSession, touchSession, verifySessionCsrf } from '../src/lib/server/auth/session';

vi.mock('../src/lib/server/database', () => ({ getDatabasePool: vi.fn(() => ({})) }));
vi.mock('../src/lib/server/auth/session', () => ({
  findSession: vi.fn(), touchSession: vi.fn(), verifySessionCsrf: vi.fn(), rotateSessionCsrf: vi.fn(),
}));

const session = {
  id: 'id', adminUserId: 1, role: 'owner', email: 'admin@example.com', csrfTokenDigest: Buffer.from('csrf'),
  expiresAt: new Date('2026-09-01T08:00:00Z'), idleExpiresAt: new Date('2026-09-01T00:30:00Z'),
};
const url = 'https://miracon.gr/api/auth/activity';
function request(method: string, headers: Record<string, string> = {}) {
  return new Request(url, { method, headers: { cookie: '__Host-session=token', ...headers } });
}

describe('explicit session activity', () => {
  beforeEach(() => {
    vi.mocked(findSession).mockReset().mockResolvedValue(session);
    vi.mocked(touchSession).mockReset().mockResolvedValue({ ...session, idleExpiresAt: new Date('2026-09-01T00:45:00Z') });
    vi.mocked(verifySessionCsrf).mockReset().mockReturnValue(true);
    vi.stubEnv('PUBLIC_SITE_URL', 'https://miracon.gr');
  });

  it('GET status never touches and reports the stored idle deadline', async () => {
    const response = await status({ request: request('GET') } as never);
    expect(response.status).toBe(200);
    expect((await response.json()).idleExpiresAt).toBe('2026-09-01T00:30:00.000Z');
    expect(touchSession).not.toHaveBeenCalled();
  });

  it('rejects missing CSRF and wrong Origin without touching', async () => {
    expect((await activity({ request: request('POST') } as never)).status).toBe(403);
    expect((await activity({ request: request('POST', { 'x-csrf-token': 'csrf', origin: 'https://evil.test' }) } as never)).status).toBe(403);
    expect(touchSession).not.toHaveBeenCalled();
  });

  it('only touches a valid mutation and returns the new deadline', async () => {
    const response = await activity({ request: request('POST', { 'x-csrf-token': 'csrf', origin: 'https://miracon.gr' }) } as never);
    expect(response.status).toBe(200);
    expect((await response.json()).idleExpiresAt).toBe('2026-09-01T00:45:00.000Z');
    expect(touchSession).toHaveBeenCalledOnce();
  });

  it('returns 401 when the read or atomic update discovers expiry', async () => {
    vi.mocked(findSession).mockResolvedValueOnce(null);
    expect((await activity({ request: request('POST') } as never)).status).toBe(401);
    vi.mocked(touchSession).mockResolvedValueOnce(null);
    expect((await activity({ request: request('POST', { 'x-csrf-token': 'csrf', origin: 'https://miracon.gr' }) } as never)).status).toBe(401);
  });

  it('CSRF rotation is not activity', async () => {
    await csrf({ request: request('POST', { origin: 'https://miracon.gr' }) } as never);
    expect(touchSession).not.toHaveBeenCalled();
  });
});
