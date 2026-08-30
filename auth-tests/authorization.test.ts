import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedSession } from '../src/lib/server/auth/session';
import { ADMIN_CAPABILITIES, hasCapability, type AdminCapability } from '../src/lib/server/auth/authorization';

vi.mock('../src/lib/server/database', () => ({ getDatabasePool: vi.fn() }));
vi.mock('../src/lib/server/auth/request-security', () => ({ verifySameOriginMutation: vi.fn() }));
vi.mock('../src/lib/server/auth/session', () => ({
  findSession: vi.fn(),
  verifySessionCsrf: vi.fn(),
}));

import {
  requireAdminMutationCapability,
  requireSessionCapability,
} from '../src/lib/server/api';
import { verifySameOriginMutation } from '../src/lib/server/auth/request-security';
import { findSession, verifySessionCsrf } from '../src/lib/server/auth/session';

const ownerSession: AuthenticatedSession = {
  id: 'owner-session',
  adminUserId: 1,
  csrfTokenDigest: Buffer.from('owner-csrf'),
  expiresAt: new Date('2026-08-29T12:00:00.000Z'),
  role: 'owner',
  email: 'admin@miracon.gr',
};

const editorSession: AuthenticatedSession = {
  ...ownerSession,
  id: 'editor-session',
  adminUserId: 2,
  role: 'editor',
};

const sessionRequest = new Request('https://miracon.gr/api/admin/projects', {
  headers: { cookie: '__Host-session=session-token' },
  method: 'POST',
});

const mutationRequest = new Request('https://miracon.gr/api/admin/projects', {
  headers: {
    cookie: '__Host-session=session-token',
    'x-csrf-token': 'csrf-token',
  },
  method: 'POST',
});

describe('centralized administrator authorization', () => {
  beforeEach(() => {
    vi.mocked(findSession).mockReset();
    vi.mocked(verifySessionCsrf).mockReset();
    vi.mocked(verifySameOriginMutation).mockReset();
  });

  it('grants every declared capability to the owner', () => {
    // Given
    const expectedCapabilities: readonly AdminCapability[] = [
      'readAdmin',
      'proposeProject',
      'proposeHomepageHero',
      'proposeSiteSettings',
      'publishOwnRevision',
      'approveRevision',
      'rejectRevision',
      'rollbackRevision',
      'manageEditors',
      'deleteProject',
      'reorderProjects',
    ];

    // When
    const permissions = ADMIN_CAPABILITIES.map((capability) => hasCapability('owner', capability));

    // Then
    expect(ADMIN_CAPABILITIES).toEqual(expectedCapabilities);
    expect(permissions).toEqual(expectedCapabilities.map(() => true));
  });

  it('grants only read and proposal capabilities to the editor', () => {
    // Given
    const expectedPermissions: Readonly<Record<AdminCapability, boolean>> = {
      readAdmin: true,
      proposeProject: true,
      proposeHomepageHero: true,
      proposeSiteSettings: true,
      publishOwnRevision: false,
      approveRevision: false,
      rejectRevision: false,
      rollbackRevision: false,
      manageEditors: false,
      deleteProject: false,
      reorderProjects: false,
    };

    // When
    const permissions = Object.fromEntries(
      ADMIN_CAPABILITIES.map((capability) => [capability, hasCapability('editor', capability)]),
    );

    // Then
    expect(permissions).toEqual(expectedPermissions);
  });

  it('returns the session authentication failure before evaluating a capability', async () => {
    // Given
    const request = new Request('https://miracon.gr/api/admin/projects');

    // When
    const result = await requireSessionCapability(request, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the request to be unauthorized');
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Authentication is required' },
    });
  });

  it('returns forbidden for an authenticated editor without the required capability', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(editorSession);

    // When
    const result = await requireSessionCapability(sessionRequest, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the editor request to be forbidden');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
    });
  });

  it('returns the guarded owner session when the capability is granted', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(ownerSession);

    // When
    const result = await requireSessionCapability(sessionRequest, 'approveRevision');

    // Then
    expect(result).toEqual({ ok: true, value: { session: ownerSession, sessionToken: 'session-token' } });
  });

  it('returns the mutation authentication failure before CSRF, origin, and capability checks', async () => {
    // Given
    const request = new Request('https://miracon.gr/api/admin/projects', { method: 'POST' });

    // When
    const result = await requireAdminMutationCapability(request, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the mutation request to be unauthorized');
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Authentication is required' },
    });
  });

  it('returns CSRF failure before evaluating a mutation capability', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(editorSession);

    // When
    const result = await requireAdminMutationCapability(sessionRequest, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the mutation request to fail CSRF validation');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: { code: 'csrf_failed', message: 'CSRF validation failed' },
    });
  });

  it('returns origin failure before evaluating a mutation capability', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(editorSession);
    vi.mocked(verifySessionCsrf).mockReturnValue(true);
    vi.mocked(verifySameOriginMutation).mockReturnValue(false);

    // When
    const result = await requireAdminMutationCapability(mutationRequest, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the mutation request to fail origin validation');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: { code: 'origin_failed', message: 'Origin validation failed' },
    });
  });

  it('returns forbidden after successful mutation security checks for an editor', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(editorSession);
    vi.mocked(verifySessionCsrf).mockReturnValue(true);
    vi.mocked(verifySameOriginMutation).mockReturnValue(true);

    // When
    const result = await requireAdminMutationCapability(mutationRequest, 'approveRevision');

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the editor mutation to be forbidden');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
    });
  });

  it('returns the guarded owner session after successful mutation security checks', async () => {
    // Given
    vi.mocked(findSession).mockResolvedValue(ownerSession);
    vi.mocked(verifySessionCsrf).mockReturnValue(true);
    vi.mocked(verifySameOriginMutation).mockReturnValue(true);

    // When
    const result = await requireAdminMutationCapability(mutationRequest, 'approveRevision');

    // Then
    expect(result).toEqual({ ok: true, value: { session: ownerSession, sessionToken: 'session-token' } });
  });
});
