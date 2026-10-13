import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedSession } from '../src/lib/server/auth/session';
import { ADMIN_CAPABILITIES, hasCapability, type AdminCapability } from '../src/lib/server/auth/authorization';
import { GET as listContacts } from '../src/pages/api/admin/contacts/index';
import { GET as getContact, DELETE as deleteContact } from '../src/pages/api/admin/contacts/[id]';
import { GET as exportContacts } from '../src/pages/api/admin/contacts/export';

const contactStore = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  exportAll: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/lib/server/database', () => ({ getDatabasePool: vi.fn() }));
vi.mock('../src/lib/server/auth/request-security', () => ({ verifySameOriginMutation: vi.fn() }));
vi.mock('../src/lib/server/auth/session', () => ({
  findSession: vi.fn(),
  verifySessionCsrf: vi.fn(),
}));
vi.mock('../src/lib/server/contact-repository', () => ({
  PostgresContactRepository: class {
    list = contactStore.list;
    get = contactStore.get;
    exportAll = contactStore.exportAll;
    delete = contactStore.delete;
  },
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
  idleExpiresAt: new Date('2026-08-29T04:30:00.000Z'),
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
    for (const method of Object.values(contactStore)) method.mockReset();
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
      'manageContacts',
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
      manageContacts: false,
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

describe('contact administration privacy', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const personalEmail = 'private-person@example.test';
  const contact = {
    id,
    name: 'Private Person',
    email: personalEmail,
    phone: '+30 210 123 4567',
    message: 'Private enquiry',
    locale: 'en',
    sourcePath: '/contact',
    createdAt: new Date('2026-09-12T10:00:00Z'),
    consentedAt: new Date('2026-09-12T10:00:00Z'),
  };
  const request = (path: string, method: 'GET' | 'DELETE' = 'GET') =>
    new Request(`https://miracon.gr${path}`, {
      method,
      headers: {
        cookie: '__Host-session=session-token',
        ...(method === 'DELETE' ? { origin: 'https://miracon.gr', 'x-csrf-token': 'csrf-token' } : {}),
      },
    });

  beforeEach(() => {
    contactStore.list.mockReset();
    contactStore.get.mockReset();
    contactStore.exportAll.mockReset();
    contactStore.delete.mockReset();
    vi.mocked(findSession).mockReset();
    vi.mocked(verifySessionCsrf).mockReset();
    vi.mocked(verifySameOriginMutation).mockReset();
    contactStore.list.mockResolvedValue([contact]);
    contactStore.get.mockResolvedValue(contact);
    contactStore.exportAll.mockResolvedValue([contact]);
    contactStore.delete.mockResolvedValue(true);
  });

  it('returns contact details and CSV to owners, but denies editors without contacting the repository', async () => {
    const endpoints = [
      { route: '/api/admin/contacts', call: (req: Request) => listContacts({ request: req, params: {} }) },
      { route: `/api/admin/contacts/${id}`, call: (req: Request) => getContact({ request: req, params: { id } }) },
      { route: '/api/admin/contacts/export', call: (req: Request) => exportContacts({ request: req, params: {} }) },
    ];
    vi.mocked(findSession).mockResolvedValue(editorSession);
    for (const endpoint of endpoints) {
      const response = await endpoint.call(request(endpoint.route));
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
      });
      expect(body).not.toContain(personalEmail);
    }
    expect(contactStore.list).not.toHaveBeenCalled();
    expect(contactStore.get).not.toHaveBeenCalled();
    expect(contactStore.exportAll).not.toHaveBeenCalled();

    vi.mocked(findSession).mockResolvedValue(ownerSession);
    const [listed, detail, exported] = await Promise.all(endpoints.map((endpoint) => endpoint.call(request(endpoint.route))));
    expect(listed.status).toBe(200);
    expect((await listed.json()).contacts).toEqual([expect.objectContaining({ email: personalEmail })]);
    expect(detail.status).toBe(200);
    expect((await detail.json()).contact).toEqual(expect.objectContaining({ email: personalEmail }));
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain(personalEmail);
  });

  it('denies an editor deletion even with valid mutation security while permitting the owner', async () => {
    vi.mocked(verifySessionCsrf).mockReturnValue(true);
    vi.mocked(verifySameOriginMutation).mockReturnValue(true);
    vi.mocked(findSession).mockResolvedValue(editorSession);
    const path = `/api/admin/contacts/${id}`;
    const denied = await deleteContact({ request: request(path, 'DELETE'), params: { id } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: 'forbidden', message: 'You do not have permission to perform this action' },
    });
    expect(contactStore.delete).not.toHaveBeenCalled();

    vi.mocked(findSession).mockResolvedValue(ownerSession);
    const deleted = await deleteContact({ request: request(path, 'DELETE'), params: { id } });
    expect(deleted.status).toBe(204);
    expect(contactStore.delete).toHaveBeenCalledWith(id);
  });

});
