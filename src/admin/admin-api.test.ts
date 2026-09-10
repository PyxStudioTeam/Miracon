import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AdminApi, AdminApiError } from './admin-api';
import { parseRemainingUnitsInput } from './remaining-units';
import type { Project } from '../lib/project-types';

describe('AdminApi', () => {
  it('calls the native-style fetcher without binding it to the API instance', async () => {
    // Given
    function fetcher(this: unknown): Promise<Response> {
      expect(this).toBeUndefined();
      return Promise.resolve(jsonResponse({ authenticated: true, expiresAt: '2026-08-12T00:00:00.000Z' }));
    }
    const api = new AdminApi({ fetcher });

    // When / Then
    await expect(api.session()).resolves.toMatchObject({ authenticated: true });
  });

  it('rotates CSRF before sending a project mutation with same-origin credentials', async () => {
    // Given
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'rotated-token' }))
      .mockResolvedValueOnce(jsonResponse({ project: projectFixture() }, 201));
    const api = new AdminApi({ fetcher });

    // When
    await api.bootstrapCsrf();
    await api.saveProject(projectFixture());

    // Then
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/csrf', expect.objectContaining({ credentials: 'same-origin', method: 'POST' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/admin/projects', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'rotated-token' }),
      method: 'POST',
    }));
  });

  it('clears the caller state when a protected request receives 401', async () => {
    // Given
    const onUnauthorized = vi.fn();
    const api = new AdminApi({
      fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'Session expired' } }, 401)),
      onUnauthorized,
    });

    // When
    const request = api.listProjects();

    // Then
    await expect(request).rejects.toBeInstanceOf(AdminApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('uploads a raster benefit icon as multipart data without a direct-storage transport', async () => {
    // Given
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'upload-token' }))
      .mockResolvedValueOnce(jsonResponse({ media: {
      id: 'media-id', relativeUrl: '/media/project.webp', relativePath: 'project.webp', originalName: 'project.webp', mimeType: 'image/webp', sizeBytes: 12, sha256: '',
      } }, 201));
    const api = new AdminApi({ fetcher });
    const icon = new File(['image'], 'benefit-icon.webp', { type: 'image/webp' });

    // When
    await api.bootstrapCsrf();
    await api.uploadMedia(icon);

    // Then
    expect(fetcher).toHaveBeenLastCalledWith('/api/admin/media', expect.objectContaining({
      body: expect.any(FormData),
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'upload-token' }),
      method: 'POST',
    }));
    const uploadRequest = fetcher.mock.calls[1]?.[1];
    if (!(uploadRequest?.body instanceof FormData)) throw new Error('Expected multipart media request');
    expect(uploadRequest.body.get('file')).toMatchObject({ name: 'benefit-icon.webp', type: 'image/webp' });
  });

  it('manages admin users list and creation with CSRF protection', async () => {
    // Given
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'user-token' }))
      .mockResolvedValueOnce(jsonResponse({ users: [
        { id: 1, email: 'owner@miracon.gr', role: 'owner', isActive: true, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: null },
      ] }))
      .mockResolvedValueOnce(jsonResponse({ user: {
        id: 2, email: 'editor@miracon.gr', role: 'editor', isActive: true, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: null,
      } }, 201));
    const api = new AdminApi({ fetcher });

    // When
    await api.bootstrapCsrf();
    const users = await api.listUsers();
    const newUser = await api.createUser('editor@miracon.gr', 'ValidPassword123456');

    // Then
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('owner@miracon.gr');
    expect(newUser.id).toBe(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/admin/users', expect.objectContaining({ credentials: 'same-origin' }));
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/admin/users', expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'user-token' }),
      method: 'POST',
    }));
  });

  it('fetches pending proposals and allows approving/rejecting', async () => {
    // Given
    const proposal = {
      id: '11111111-1111-1111-1111-111111111111',
      aggregateType: 'project' as const,
      aggregateId: 'project-1',
      revisionNumber: 2,
      state: 'pending' as const,
      action: 'proposal' as const,
      snapshot: { aggregateType: 'project', aggregateId: 'project-1', deleted: false, project: null, images: [] },
      expectedRevisionId: null,
      createdBy: 2,
      creatorEmail: 'editor@miracon.gr',
      creatorRole: 'editor' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      currentHeadRevisionId: null,
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'prop-token' }))
      .mockResolvedValueOnce(jsonResponse({ proposals: [proposal] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const api = new AdminApi({ fetcher });

    // When
    await api.bootstrapCsrf();
    const proposals = await api.listPendingProposals();
    await api.approveProposal(proposal.id, null);

    // Then
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe(proposal.id);
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/admin/revisions/${proposal.id}/approve`, expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'prop-token' }),
      method: 'POST',
    }));
  });

  it('fetches revision history and supports rollback', async () => {
    // Given
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'hist-token' }))
      .mockResolvedValueOnce(jsonResponse({ revisions: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          aggregateType: 'project',
          aggregateId: 'project-1',
          revisionNumber: 1,
          state: 'approved',
          action: 'publish',
          snapshot: {},
          expectedRevisionId: null,
          createdBy: 1,
          creatorEmail: 'owner@miracon.gr',
          creatorRole: 'owner',
          approvedBy: 1,
          approverEmail: 'owner@miracon.gr',
          approverRole: 'owner',
          createdAt: '2026-08-01T00:00:00.000Z',
          approvedAt: '2026-08-01T00:00:00.000Z',
        },
      ] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const api = new AdminApi({ fetcher });

    // When
    await api.bootstrapCsrf();
    const history = await api.getRevisionHistory('project', 'project-1');
    await api.rollbackRevision('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

    // Then
    expect(history).toHaveLength(1);
    expect(history[0].revisionNumber).toBe(1);
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/admin/revisions/rollback', expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'hist-token' }),
      method: 'POST',
      body: JSON.stringify({
        targetRevisionId: '22222222-2222-2222-2222-222222222222',
        expectedCurrentRevisionId: '33333333-3333-3333-3333-333333333333',
      }),
    }));
  });
});

describe('parseRemainingUnitsInput', () => {
  it('returns null when the field is blank', () => {
    // Given
    const blank = '';

    // When
    const remainingUnits = parseRemainingUnitsInput(blank);

    // Then
    expect(remainingUnits).toBeNull();
  });

  it('preserves zero when the field contains zero', () => {
    // Given
    const zero = '0';

    // When
    const remainingUnits = parseRemainingUnitsInput(zero);

    // Then
    expect(remainingUnits).toBe(0);
  });

  it('returns a positive whole number when the field contains one', () => {
    // Given
    const positive = '12';

    // When
    const remainingUnits = parseRemainingUnitsInput(positive);

    // Then
    expect(remainingUnits).toBe(12);
  });

  it('rejects a negative value', () => {
    // Given
    const negative = '-1';

    // When
    const remainingUnits = parseRemainingUnitsInput(negative);

    // Then
    expect(remainingUnits).toBeUndefined();
  });

  it('rejects a fractional value', () => {
    // Given
    const fractional = '1.5';

    // When
    const remainingUnits = parseRemainingUnitsInput(fractional);

    // Then
    expect(remainingUnits).toBeUndefined();
  });

  it('rejects a nonnumeric value', () => {
    // Given
    const nonNumeric = 'available';

    // When
    const remainingUnits = parseRemainingUnitsInput(nonNumeric);

    // Then
    expect(remainingUnits).toBeUndefined();
  });
});

describe('admin interface contracts', () => {
  it('uses the public SVG mark and explicit homepage-video row groups', async () => {
    // Given
    const adminApp = await readFile(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    const adminCss = await readFile(new URL('./admin.css', import.meta.url), 'utf8');

    // When
    const brandMark = adminApp.match(/function BrandMark\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    const heroVideoRow = adminApp.match(/function SortableHomeHeroVideo\([\s\S]*?\n\}\n\nfunction HomeHeroManager/)?.[0] ?? '';

    // Then
    expect(brandMark).toContain('<img src="/img/logo_mark.svg" alt="MIRACON" />');
    expect(heroVideoRow).toContain('className="home-hero-ordering"');
    expect(heroVideoRow).toContain('className="home-hero-identity"');
    expect(heroVideoRow).toContain('aria-label="Visual preview"');
    expect(heroVideoRow).toContain('className="home-hero-project-field"');
    expect(heroVideoRow).toContain('aria-label="Video uploads"');
    expect(heroVideoRow).toContain('Desktop video');
    expect(heroVideoRow).toContain('Mobile video (optional)');
    expect(heroVideoRow).toContain('aria-label="Upload desktop MP4"');
    expect(heroVideoRow).toContain('aria-label="Upload mobile MP4"');
    expect(heroVideoRow).toContain('aria-label={`Remove hero video ${index + 1}`}');
    expect(adminCss).toContain('.home-hero-assets label:focus-within');
    expect(adminCss).toContain('.home-hero-toggle input:focus-visible + span');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

function projectFixture(): Project {
  return {
    id: 'project-id', slug: 'project', title: 'Project', address: '', cardAddress: '', price: '', remainingUnits: null, shortDescription: '', fullDescription: '', introTitle: '', categories: [], status: 'draft', sortOrder: 0,
    coverUrl: '', coverFocalX: 50, coverFocalY: 50, heroType: 'image', heroVariant: 'standard', heroSoundEnabled: false, heroIdleUi: false, heroUrl: '', heroMobileUrl: null, heroPosterUrl: null, heroVideos: [],
    walkthroughVideoEnabled: false, walkthroughVideoTitle: '', walkthroughVideoDesktopUrl: '', walkthroughVideoMobileUrl: null, walkthroughVideoPosterUrl: null, walkthroughVideos: [], heroFocalX: 50, heroFocalY: 50,
    introImageUrl: '', brochureUrl: null, mapQuery: '', mapUrl: '', cardImages: [], gallery: [], characteristics: [], benefits: [], floorPlanGroups: [], nearbyPlaces: [], seoTitle: '', seoDescription: '', updatedAt: '2026-08-12T00:00:00.000Z',
  };
}
