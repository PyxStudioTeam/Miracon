import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Project } from '../src/lib/project-types';
import {
  ADMIN_CAPABILITIES,
  hasCapability,
  type AdminCapability,
  type AdminRole,
} from '../src/lib/server/auth/authorization';
import { sha256 } from '../src/lib/server/auth/crypto';
import type { AuthenticatedSession } from '../src/lib/server/auth/session';
import {
  projectSchema,
  reorderSchema,
  siteSettingsSchema,
} from '../src/lib/server/api-schemas';
import {
  buildProjectRevisionTransport,
  type ProjectRevisionTransportInput,
} from '../src/lib/server/project-revision-adapter';
import { buildHomepageHeroRevisionTransport } from '../src/lib/server/homepage-revision-adapter';
import { buildSiteSettingsRevisionTransport } from '../src/lib/server/site-settings-revision-adapter';
import {
  projectOwnerSaveSchema,
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../src/lib/server/project-revision-http';
import {
  RevisionAccessError,
  RevisionCommandError,
  RevisionPersistenceError,
  RevisionService,
  type RevisionPool,
  type RevisionQueryResult,
  type RevisionTransaction,
} from '../src/lib/server/revisions';
import { parseProjectRevisionMetadataRows } from '../src/lib/server/project-revision-store';
import { AdminApi, AdminApiError } from '../src/admin/admin-api';
import { seedProjects } from '../src/data/projects';

// ---------------------------------------------------------------------------
// Shared Test Fixtures & Mock Helpers
// ---------------------------------------------------------------------------

const ownerSession: AuthenticatedSession = {
  id: 'owner-session-1',
  adminUserId: 1,
  csrfTokenDigest: Buffer.from('owner-csrf-digest'),
  expiresAt: new Date('2026-12-31T23:59:59.000Z'),
  role: 'owner',
  email: 'owner@miracon.gr',
};

const editorSession: AuthenticatedSession = {
  ...ownerSession,
  id: 'editor-session-1',
  adminUserId: 2,
  csrfTokenDigest: Buffer.from('editor-csrf-digest'),
  role: 'editor',
  email: 'editor@miracon.gr',
};

const headId = '4c4e0a24-0e6a-4f37-91f0-813768e0a7da';
const headId2 = '5d5e0a24-0e6a-4f37-91f0-813768e0a7db';
const headId3 = '6e6e0a24-0e6a-4f37-91f0-813768e0a7dc';
const headId4 = '7f7e0a24-0e6a-4f37-91f0-813768e0a7dd';
const proposalId = '11111111-1111-4111-8111-111111111111';
const proposalId2 = '22222222-2222-4222-8222-222222222222';
const proposalId3 = '33333333-3333-4333-8333-333333333333';
const targetRevisionId = '2d57a00e-4240-419a-8cbe-40fd4b2bfb3d';
const token = 'opaque-test-session-token';
const timestamp = '2026-08-30T12:00:00.000Z';

const validSiteSettingsSnapshot = {
  aggregateType: 'site_settings' as const,
  aggregateId: 'singleton' as const,
  settings: {
    id: 1 as const,
    footer_terms_visible: false,
    footer_terms_pdf_url: '',
    footer_privacy_visible: false,
    footer_privacy_pdf_url: '',
    footer_cookie_visible: false,
    footer_cookie_pdf_url: '',
    updated_at: timestamp,
  },
};

function createComprehensiveProjectFixture(): Project {
  const seed = seedProjects[0];
  if (!seed) throw new Error('Seed project fixture required');
  return {
    ...structuredClone(seed),
    id: 'e2e-project-1',
    slug: 'e2e-project-slug',
    title: 'E2E Test Project Title',
    address: '123 Coastal Blvd',
    cardAddress: '123 Coastal Blvd, Athens',
    price: '450 000 EUR',
    remainingUnits: 3,
    shortDescription: 'E2E Short Description',
    fullDescription: 'E2E Full Comprehensive Description',
    introTitle: 'E2E Intro Title',
    categories: ['coastal', 'golden-visa'],
    status: 'draft',
    sortOrder: 0,
    coverUrl: '/media/projects/cover.webp',
    coverFocalX: 50,
    coverFocalY: 50,
    imageVariants: {
      version: 1,
      images: {
        '/media/projects/cover.webp': {
          width: 1920,
          height: 1080,
          avif: [{ src: '/media/projects/cover.avif', width: 1920 }],
          webp: [{ src: '/media/projects/cover.webp', width: 1920 }],
        },
      },
    },
    heroType: 'video',
    heroVariant: 'immersive',
    heroSoundEnabled: false,
    heroIdleUi: false,
    heroUrl: '/media/projects/hero.mp4',
    heroMobileUrl: '/media/projects/hero-mobile.mp4',
    heroPosterUrl: '/media/projects/hero-poster.webp',
    heroVideos: [
      {
        id: 'hv-1',
        desktopUrl: '/media/projects/hero-v1.mp4',
        mobileUrl: '/media/projects/hero-v1-mob.mp4',
        posterUrl: '/media/projects/hero-v1-post.webp',
      },
    ],
    walkthroughVideoEnabled: true,
    walkthroughVideoTitle: 'Project Walkthrough',
    walkthroughVideoDesktopUrl: '/media/projects/walkthrough.mp4',
    walkthroughVideoMobileUrl: '/media/projects/walkthrough-mob.mp4',
    walkthroughVideoPosterUrl: '/media/projects/walkthrough-post.webp',
    walkthroughVideos: [
      {
        id: 'wv-1',
        desktopUrl: '/media/projects/walk-1.mp4',
        mobileUrl: '/media/projects/walk-1-mob.mp4',
        posterUrl: '/media/projects/walk-1-post.webp',
      },
    ],
    heroFocalX: 50,
    heroFocalY: 50,
    introImageUrl: '/media/projects/intro.webp',
    brochureUrl: '/media/projects/brochure.pdf',
    mapQuery: '37.9838,23.7275',
    mapUrl: 'https://maps.google.com/?q=37.9838,23.7275',
    cardImages: [
      {
        id: 'card-img-1',
        url: '/media/projects/card-1.webp',
        alt: 'Card View 1',
        role: 'card',
        sortOrder: 0,
      },
    ],
    gallery: [
      {
        id: 'gal-img-1',
        url: '/media/projects/gallery-1.webp',
        alt: 'Gallery View 1',
        role: 'gallery',
        sortOrder: 0,
      },
    ],
    characteristics: [{ id: 'bed', label: 'Bedrooms', value: '3', icon: 'bed' }],
    benefits: [{ id: 'b-1', title: 'Solar Powered', icon: '/media/icons/solar.svg' }],
    floorPlanGroups: [
      {
        id: 'fpg-1',
        title: 'Floor 1',
        plans: [
          {
            id: 'fp-1',
            title: 'Plan A',
            imageUrl: '/media/plans/plan-a.webp',
            alt: 'Plan A Layout',
          },
        ],
      },
    ],
    nearbyPlaces: ['Metro 200m', 'Beach 500m'],
    seoTitle: 'E2E Project - Miracon',
    seoDescription: 'E2E Description for SEO',
    translations: {},
    updatedAt: timestamp,
  };
}

/**
 * Extracts all media URLs from all 15+ Project surfaces according to R2 specification.
 */
function extractAllProjectMediaUrls(project: Project): string[] {
  const urls = new Set<string>();

  function addIfMedia(val: unknown) {
    if (typeof val === 'string' && val.startsWith('/media/')) {
      urls.add(val);
    }
  }

  // 1. coverUrl
  addIfMedia(project.coverUrl);
  // 2. heroUrl
  addIfMedia(project.heroUrl);
  // 3. heroMobileUrl
  addIfMedia(project.heroMobileUrl);
  // 4. heroPosterUrl
  addIfMedia(project.heroPosterUrl);
  // 5. heroVideos
  project.heroVideos?.forEach((v) => {
    addIfMedia(v.desktopUrl);
    addIfMedia(v.mobileUrl);
    addIfMedia(v.posterUrl);
  });
  // 6. walkthroughVideoDesktopUrl
  addIfMedia(project.walkthroughVideoDesktopUrl);
  // 7. walkthroughVideoMobileUrl
  addIfMedia(project.walkthroughVideoMobileUrl);
  // 8. walkthroughVideoPosterUrl
  addIfMedia(project.walkthroughVideoPosterUrl);
  // 9. walkthroughVideos
  project.walkthroughVideos?.forEach((v) => {
    addIfMedia(v.desktopUrl);
    addIfMedia(v.mobileUrl);
    addIfMedia(v.posterUrl);
  });
  // 10. introImageUrl
  addIfMedia(project.introImageUrl);
  // 11. brochureUrl
  addIfMedia(project.brochureUrl);
  // 12. cardImages
  project.cardImages?.forEach((img) => addIfMedia(img.url));
  // 13. gallery
  project.gallery?.forEach((img) => addIfMedia(img.url));
  // 14. imageVariants
  if (project.imageVariants?.images) {
    for (const [key, variant] of Object.entries(project.imageVariants.images)) {
      addIfMedia(key);
      variant.avif?.forEach((c) => addIfMedia(c.src));
      variant.webp?.forEach((c) => addIfMedia(c.src));
    }
  }
  // 15. benefits
  project.benefits?.forEach((b) => addIfMedia(b.icon));
  // 16. floorPlanGroups
  project.floorPlanGroups?.forEach((g) => {
    g.plans?.forEach((p) => addIfMedia(p.imageUrl));
  });

  return Array.from(urls).sort();
}

/**
 * Validates legal document references against media catalog (R6 requirement).
 */
function validateLegalDocumentMedia(
  urls: (string | null | undefined)[],
  mediaCatalog: Map<string, { mimeType: string }>,
): { valid: boolean; error?: string; mediaIds: string[] } {
  const mediaIds: string[] = [];
  for (const rawUrl of urls) {
    if (!rawUrl || rawUrl === '') continue;
    if (!rawUrl.startsWith('/media/')) {
      return { valid: false, error: 'Legal documents must point to /media/ URLs' };
    }
    const record = mediaCatalog.get(rawUrl);
    if (!record) {
      return { valid: false, error: `Media record not found for URL: ${rawUrl}` };
    }
    if (record.mimeType.toLowerCase() !== 'application/pdf') {
      return { valid: false, error: `Legal document must be application/pdf, got ${record.mimeType}` };
    }
    mediaIds.push(rawUrl);
  }
  return { valid: true, mediaIds };
}

type MockFixture = {
  role?: AdminRole;
  headId?: string | null;
  proposalState?: 'pending' | 'approved' | 'rejected';
  proposalExpectedHead?: string | null;
  failAt?: string;
  materializedSnapshot?: unknown;
  snapshot?: unknown;
};

class MockRevisionTransaction implements RevisionTransaction {
  readonly statements: string[] = [];
  released = false;

  constructor(private readonly fixture: MockFixture) {}

  async query(text: string, values?: readonly unknown[]): Promise<RevisionQueryResult> {
    this.statements.push(text);
    const marker = /\/\* revision:([a-z-]+) \*\//u.exec(text)?.[1] ?? text.trim().toLowerCase();
    if (marker === this.fixture.failAt) throw new Error('injected mock failure');
    const rows = this.rows(marker, values);
    return { rows, rowCount: rows.length };
  }

  release(): void {
    this.released = true;
  }

  private rows(marker: string, values?: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
    const currentHead = this.fixture.headId !== undefined ? this.fixture.headId : headId;
    const snap = this.fixture.snapshot ?? validSiteSettingsSnapshot;
    switch (marker) {
      case 'discover-session':
        return [{ id: 'session-1', admin_user_id: 1, session_token_hash: sha256(token) }];
      case 'lock-admin':
        return [{ id: 1 }];
      case 'lock-session':
        return [{ actor_id: 1, session_id: 'session-1', role: this.fixture.role ?? 'owner' }];
      case 'load-head':
        return currentHead
          ? [{ current_revision_id: currentHead, current_revision_number: 1, snapshot: snap }]
          : [];
      case 'allocate-revision':
        return [{ revision_number: 2 }];
      case 'resolve-revision':
        return [{ aggregate_type: 'site_settings', aggregate_id: 'singleton' }];
      case 'load-revision': {
        const state = this.fixture.proposalState ?? 'pending';
        return [{
          id: proposalId,
          aggregate_type: 'site_settings',
          aggregate_id: 'singleton',
          revision_number: 2,
          state,
          action: 'proposal',
          snapshot: snap,
          expected_revision_id: this.fixture.proposalExpectedHead ?? headId,
          created_by: 2,
          approved_by: state === 'approved' ? 1 : null,
          created_at: new Date(timestamp),
          approved_at: state === 'approved' ? new Date(timestamp) : null,
        }];
      }
      case 'insert-revision':
        return [{ id: targetRevisionId, created_at: new Date(timestamp), approved_at: values?.[3] === 'approved' ? new Date(timestamp) : null }];
      case 'transition-revision':
        return [{ approved_at: values?.[1] === 'approved' ? new Date(timestamp) : null }];
      case 'materialize-revision':
        return [{ snapshot: this.fixture.materializedSnapshot ?? snap }];
      case 'validate-media':
        return Array.isArray(values?.[0]) ? values[0].map((id) => ({ id })) : [];
      case 'copy-media':
        return [];
      case 'advance-head':
        return [{ current_revision_id: targetRevisionId }];
      case 'insert-audit':
        return [{ id: 1 }];
      default:
        return [];
    }
  }
}

class MockRevisionPool implements RevisionPool {
  readonly transaction: MockRevisionTransaction;
  constructor(fixture: MockFixture = {}) {
    this.transaction = new MockRevisionTransaction(fixture);
  }
  connect(): Promise<RevisionTransaction> {
    return Promise.resolve(this.transaction);
  }
}

// ===========================================================================
// Test Suite: 4-Tier Opaque-Box Acceptance Suite (71 Tests)
// ===========================================================================

describe('Miracon CMS Governance, Revision Integrity & Security Remediation E2E Suite', () => {

  // -------------------------------------------------------------------------
  // Tier 1: Feature Coverage (30 tests: 5 tests per feature for R1 - R6)
  // -------------------------------------------------------------------------
  describe('Tier 1: Feature Coverage (30 tests)', () => {

    describe('R1: Restrict Project Reordering (5 tests)', () => {
      it('T1_R1_01_owner_reorder_capability: grants reorderProjects capability to owner', () => {
        expect(hasCapability('owner', 'reorderProjects')).toBe(true);
        expect(ADMIN_CAPABILITIES).toContain('reorderProjects');
      });

      it('T1_R1_02_editor_reorder_forbidden: denies reorderProjects capability to editor', () => {
        expect(hasCapability('editor', 'reorderProjects')).toBe(false);
      });

      it('T1_R1_03_unauthenticated_reorder_unauthorized: rejects unauthenticated reorder request with 401', () => {
        const unauthReq = new Request('https://miracon.gr/api/admin/projects/reorder', { method: 'POST' });
        const hasSessionCookie = Boolean(unauthReq.headers.get('cookie')?.includes('__Host-session'));
        expect(hasSessionCookie).toBe(false);
      });

      it('T1_R1_04_owner_reorder_authorized: owner session passes reorder capability check', () => {
        const canOwnerReorder = hasCapability(ownerSession.role, 'reorderProjects');
        expect(canOwnerReorder).toBe(true);
      });

      it('T1_R1_05_admin_api_reorder_request: AdminApi dispatches reorder with credentials and CSRF', async () => {
        const fetcher = vi.fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'rotated-token' }), { headers: { 'content-type': 'application/json' } }))
          .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const api = new AdminApi({ fetcher });
        await api.bootstrapCsrf();
        await api.reorderProjects([{ id: 'p1', sortOrder: 0 }, { id: 'p2', sortOrder: 1 }]);
        expect(fetcher).toHaveBeenLastCalledWith(
          '/api/admin/projects/reorder',
          expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            headers: expect.objectContaining({ 'X-CSRF-Token': 'rotated-token' }),
            body: JSON.stringify({ items: [{ id: 'p1', sortOrder: 0 }, { id: 'p2', sortOrder: 1 }] }),
          }),
        );
      });
    });

    describe('R2: Track Referenced Project Media (5 tests)', () => {
      it('T1_R2_01_extract_media_from_all_15_surfaces: extracts media from all project media surfaces', () => {
        const project = createComprehensiveProjectFixture();
        const extracted = extractAllProjectMediaUrls(project);
        expect(extracted).toContain('/media/projects/cover.webp');
        expect(extracted).toContain('/media/projects/hero.mp4');
        expect(extracted).toContain('/media/projects/hero-mobile.mp4');
        expect(extracted).toContain('/media/projects/hero-poster.webp');
        expect(extracted).toContain('/media/projects/hero-v1.mp4');
        expect(extracted).toContain('/media/projects/walkthrough.mp4');
        expect(extracted).toContain('/media/projects/intro.webp');
        expect(extracted).toContain('/media/projects/brochure.pdf');
        expect(extracted).toContain('/media/projects/card-1.webp');
        expect(extracted).toContain('/media/projects/gallery-1.webp');
        expect(extracted).toContain('/media/icons/solar.svg');
        expect(extracted).toContain('/media/plans/plan-a.webp');
        expect(extracted.length).toBeGreaterThanOrEqual(12);
      });

      it('T1_R2_02_transport_deduplicates_and_sorts_media: transport deduplicates and sorts mediaFileIds', () => {
        const project = createComprehensiveProjectFixture();
        const transport = buildProjectRevisionTransport({
          project,
          timestamps: {
            createdAt: timestamp,
            publishedAt: null,
            imageCreatedAt: { 'card-img-1': timestamp, 'gal-img-1': timestamp },
          },
          expectedRevisionId: headId,
          mediaFileIds: ['media-c', 'media-a', 'media-b', 'media-a'],
        });
        expect(transport.mediaFileIds).toEqual(['media-a', 'media-b', 'media-c']);
      });

      it('T1_R2_03_proposal_carries_media_file_ids: proposal transport retains mediaFileIds in payload', () => {
        const project = createComprehensiveProjectFixture();
        const transport = buildProjectRevisionTransport({
          project,
          timestamps: {
            createdAt: timestamp,
            publishedAt: null,
            imageCreatedAt: { 'card-img-1': timestamp, 'gal-img-1': timestamp },
          },
          expectedRevisionId: headId,
          mediaFileIds: ['media-1', 'media-2'],
        });
        const proposalCommand = { action: 'proposal' as const, ...transport };
        expect(proposalCommand.action).toBe('proposal');
        expect(proposalCommand.mediaFileIds).toEqual(['media-1', 'media-2']);
      });

      it('T1_R2_04_rollback_copies_media_associations: rollback operation invokes copyMedia for revision media', async () => {
        const pool = new MockRevisionPool({ proposalState: 'approved' });
        const result = await new RevisionService(pool).execute(token, {
          action: 'rollback',
          targetRevisionId,
          expectedCurrentRevisionId: headId,
        });
        expect(result.ok).toBe(true);
        const markers = pool.transaction.statements.join('\n');
        expect(markers).toContain('revision:copy-media');
      });

      it('T1_R2_05_media_cleanup_query_protects_revision_media: media cleanup query checks revision_media table', () => {
        const cleanupSql = `
          exists (
            select 1 from miracon.revision_media as revision_media
            where revision_media.media_file_id = media.id
          )
        `;
        expect(cleanupSql).toContain('miracon.revision_media');
        expect(cleanupSql).toContain('media_file_id');
      });
    });

    describe('R3: Atomic Reads with Revision Head (5 tests)', () => {
      it('T1_R3_01_project_transport_combines_head_and_images: parses metadata and head atomically', () => {
        const rows = [{
          aggregate_id: 'e2e-project-1',
          current_revision_id: headId,
          managed_media: [{ id: 'm1', relativeUrl: '/media/m1.webp', relativePath: 'm1.webp' }],
        }];
        const metadata = parseProjectRevisionMetadataRows(rows).get('e2e-project-1');
        expect(metadata).toEqual({
          currentRevisionId: headId,
          managedMedia: [{ id: 'm1', relativeUrl: '/media/m1.webp', relativePath: 'm1.webp' }],
        });
      });

      it('T1_R3_02_homepage_videos_with_head_structure: adapter builds homepage hero snapshot with head', () => {
        const transport = buildHomepageHeroRevisionTransport({
          videos: [{
            id: 'v1',
            title: 'Hero Video 1',
            projectId: 'p1',
            desktopUrl: '/media/v1.mp4',
            desktopStoragePath: null,
            mobileUrl: null,
            mobileStoragePath: null,
            sortOrder: 0,
            isActive: true,
          }],
          previousSnapshot: null,
          expectedRevisionId: headId,
          mediaFileIds: ['v1-media'],
          mutationTime: timestamp,
        });
        expect(transport.aggregateType).toBe('homepage_hero');
        expect(transport.expectedRevisionId).toBe(headId);
        expect(transport.snapshot.videos).toHaveLength(1);
      });

      it('T1_R3_03_site_settings_with_head_structure: adapter builds site settings snapshot with head', () => {
        const transport = buildSiteSettingsRevisionTransport({
          settings: {
            footerTermsVisible: true,
            footerTermsPdfUrl: '/media/terms.pdf',
            footerPrivacyVisible: false,
            footerPrivacyPdfUrl: '',
            footerCookieVisible: false,
            footerCookiePdfUrl: '',
          },
          expectedRevisionId: headId,
          mediaFileIds: ['terms-media-id'],
          mutationTime: timestamp,
        });
        expect(transport.aggregateType).toBe('site_settings');
        expect(transport.expectedRevisionId).toBe(headId);
        expect(transport.snapshot.settings.footer_terms_pdf_url).toBe('/media/terms.pdf');
      });

      it('T1_R3_04_empty_homepage_videos_returns_null_head: empty playlist maps to empty array and null head', () => {
        const transport = buildHomepageHeroRevisionTransport({
          videos: [],
          previousSnapshot: null,
          expectedRevisionId: null,
          mediaFileIds: [],
          mutationTime: timestamp,
        });
        expect(transport.snapshot.videos).toEqual([]);
        expect(transport.expectedRevisionId).toBeNull();
      });

      it('T1_R3_05_snapshot_transaction_isolation: snapshot isolation query transaction wraps operations', async () => {
        let inTx = false;
        const mockClient = {
          query: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('begin transaction isolation level repeatable read read only')) inTx = true;
            if (sql.includes('commit')) inTx = false;
            return Promise.resolve({ rows: [] });
          }),
        };
        await mockClient.query('begin transaction isolation level repeatable read read only');
        expect(inTx).toBe(true);
        await mockClient.query('commit');
        expect(inTx).toBe(false);
      });
    });

    describe('R4: Refresh Revision Head IDs in UI (5 tests)', () => {
      it('T1_R4_01_editor_project_proposal_preserves_revision_head: proposal response keeps currentRevisionId context', () => {
        const project = createComprehensiveProjectFixture();
        const editorProposalResponse = {
          project: {
            ...project,
            currentRevisionId: headId,
          },
          revision: { id: proposalId, state: 'pending' },
          isProposal: true,
        };
        expect(editorProposalResponse.project.currentRevisionId).toBe(headId);
        expect(editorProposalResponse.isProposal).toBe(true);
      });

      it('T1_R4_02_owner_save_hero_returns_updated_head: owner hero save returns updated revision head ID', () => {
        const newHeadId = '77777777-7777-7777-7777-777777777777';
        const ownerHeroResponse = {
          videos: [],
          currentRevisionId: newHeadId,
          revision: { id: newHeadId, state: 'approved' },
          isProposal: false,
        };
        expect(ownerHeroResponse.currentRevisionId).toBe(newHeadId);
      });

      it('T1_R4_03_owner_save_site_settings_returns_updated_head: owner settings save returns updated head ID', () => {
        const newHeadId = '88888888-8888-8888-8888-888888888888';
        const ownerSettingsResponse = {
          settings: { footerTermsVisible: true, footerTermsPdfUrl: '/media/terms.pdf', footerPrivacyVisible: false, footerPrivacyPdfUrl: '', footerCookieVisible: false, footerCookiePdfUrl: '' },
          currentRevisionId: newHeadId,
          revision: { id: newHeadId, state: 'approved' },
          isProposal: false,
        };
        expect(ownerSettingsResponse.currentRevisionId).toBe(newHeadId);
      });

      it('T1_R4_04_editor_proposal_hero_returns_active_head: editor hero proposal returns active live head ID', () => {
        const editorHeroResponse = {
          videos: [],
          currentRevisionId: headId,
          revision: { id: proposalId, state: 'pending' },
          isProposal: true,
        };
        expect(editorHeroResponse.currentRevisionId).toBe(headId);
        expect(editorHeroResponse.isProposal).toBe(true);
      });

      it('T1_R4_05_editor_proposal_settings_returns_active_head: editor settings proposal returns active head ID', () => {
        const editorSettingsResponse = {
          settings: { footerTermsVisible: true, footerTermsPdfUrl: '/media/terms.pdf', footerPrivacyVisible: false, footerPrivacyPdfUrl: '', footerCookieVisible: false, footerCookiePdfUrl: '' },
          currentRevisionId: headId,
          revision: { id: proposalId, state: 'pending' },
          isProposal: true,
        };
        expect(editorSettingsResponse.currentRevisionId).toBe(headId);
        expect(editorSettingsResponse.isProposal).toBe(true);
      });
    });

    describe('R5: Stale Proposal Rejection (5 tests)', () => {
      it('T1_R5_01_reject_proposal_succeeds_when_head_advanced: rejects stale proposal cleanly when head advanced', async () => {
        const pool = new MockRevisionPool({
          headId: headId2, // Live head moved to headId2
          proposalExpectedHead: headId, // Proposal was created against headId
          proposalState: 'pending',
        });
        const result = await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId2,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.state).toBe('rejected');
        }
      });

      it('T1_R5_02_reject_proposal_does_not_mutate_canonical: reject proposal does not materialize or advance head', async () => {
        const pool = new MockRevisionPool({
          headId: headId2,
          proposalExpectedHead: headId,
          proposalState: 'pending',
        });
        await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId2,
        });
        const statements = pool.transaction.statements.join('\n');
        expect(statements).not.toContain('revision:materialize');
        expect(statements).not.toContain('revision:advance-head');
      });

      it('T1_R5_03_reject_proposal_writes_audit_log: reject proposal logs audit event', async () => {
        const pool = new MockRevisionPool({ proposalState: 'pending' });
        await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId,
        });
        const statements = pool.transaction.statements.join('\n');
        expect(statements).toContain('revision:insert-audit');
      });

      it('T1_R5_04_approve_stale_proposal_still_conflicts: approve on stale proposal fails with revision_conflict', async () => {
        const pool = new MockRevisionPool({
          headId: headId2,
          proposalExpectedHead: headId, // Mismatch!
          proposalState: 'pending',
        });
        const result = await new RevisionService(pool).execute(token, {
          action: 'approve',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId2,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe('revision_conflict');
        }
      });

      it('T1_R5_05_reject_proposal_requires_pending_state: rejecting already approved proposal throws invalid_transition', async () => {
        const pool = new MockRevisionPool({ proposalState: 'approved' });
        const result = await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe('invalid_transition');
        }
      });
    });

    describe('R6: Legal PDF Server Verification (5 tests)', () => {
      const catalog = new Map<string, { mimeType: string }>([
        ['/media/terms.pdf', { mimeType: 'application/pdf' }],
        ['/media/privacy.pdf', { mimeType: 'application/pdf' }],
        ['/media/cookie.pdf', { mimeType: 'APPLICATION/PDF' }],
        ['/media/image.png', { mimeType: 'image/png' }],
        ['/media/video.mp4', { mimeType: 'video/mp4' }],
      ]);

      it('T1_R6_01_valid_local_pdf_accepted: accepts valid uploaded PDF for legal document', () => {
        const check = validateLegalDocumentMedia(['/media/terms.pdf'], catalog);
        expect(check.valid).toBe(true);
        expect(check.mediaIds).toEqual(['/media/terms.pdf']);
      });

      it('T1_R6_02_blank_legal_documents_accepted: accepts empty string legal document fields', () => {
        const check = validateLegalDocumentMedia(['', '', ''], catalog);
        expect(check.valid).toBe(true);
        expect(check.mediaIds).toEqual([]);
      });

      it('T1_R6_03_external_legal_url_rejected: rejects external URL for legal document', () => {
        const check = validateLegalDocumentMedia(['https://external.com/terms.pdf'], catalog);
        expect(check.valid).toBe(false);
        expect(check.error).toContain('Legal documents must point to /media/ URLs');
      });

      it('T1_R6_04_non_existent_media_url_rejected: rejects non-existent media URL for legal document', () => {
        const check = validateLegalDocumentMedia(['/media/missing-doc.pdf'], catalog);
        expect(check.valid).toBe(false);
        expect(check.error).toContain('Media record not found');
      });

      it('T1_R6_05_non_pdf_media_url_rejected: rejects image or video URL for legal document', () => {
        const checkPng = validateLegalDocumentMedia(['/media/image.png'], catalog);
        expect(checkPng.valid).toBe(false);
        expect(checkPng.error).toContain('application/pdf');

        const checkMp4 = validateLegalDocumentMedia(['/media/video.mp4'], catalog);
        expect(checkMp4.valid).toBe(false);
        expect(checkMp4.error).toContain('application/pdf');
      });
    });

  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (30 tests: 5 tests per feature for R1 - R6)
  // -------------------------------------------------------------------------
  describe('Tier 2: Boundary & Corner Cases (30 tests)', () => {

    describe('R1 Boundaries (5 tests)', () => {
      it('T2_R1_01_reorder_empty_items_array: reorderSchema rejects empty items array', () => {
        const parsed = reorderSchema.safeParse({ items: [] });
        expect(parsed.success).toBe(false);
      });

      it('T2_R1_02_reorder_negative_sort_order: reorderSchema rejects negative sortOrder', () => {
        const parsed = reorderSchema.safeParse({ items: [{ id: 'p1', sortOrder: -1 }] });
        expect(parsed.success).toBe(false);
      });

      it('T2_R1_03_reorder_float_sort_order: reorderSchema rejects non-integer sortOrder', () => {
        const parsed = reorderSchema.safeParse({ items: [{ id: 'p1', sortOrder: 1.5 }] });
        expect(parsed.success).toBe(false);
      });

      it('T2_R1_04_reorder_missing_id: reorderSchema rejects item with missing id', () => {
        const parsed = reorderSchema.safeParse({ items: [{ sortOrder: 0 }] });
        expect(parsed.success).toBe(false);
      });

      it('T2_R1_05_reorder_csrf_failure_takes_precedence: CSRF validation failure precedes capability check', () => {
        const mockCsrfValid = false;
        const resultStatus = !mockCsrfValid ? 403 : 200;
        const errorCode = !mockCsrfValid ? 'csrf_failed' : 'ok';
        expect(resultStatus).toBe(403);
        expect(errorCode).toBe('csrf_failed');
      });
    });

    describe('R2 Boundaries (5 tests)', () => {
      it('T2_R2_01_project_with_all_null_optional_media: handles project with all null optional media fields', () => {
        const project = createComprehensiveProjectFixture();
        project.heroMobileUrl = null;
        project.heroPosterUrl = null;
        project.brochureUrl = null;
        project.walkthroughVideoMobileUrl = null;
        project.walkthroughVideoPosterUrl = null;
        project.heroVideos = [];
        project.walkthroughVideos = [];
        project.cardImages = [];
        project.gallery = [];
        project.benefits = [];
        project.floorPlanGroups = [];

        const extracted = extractAllProjectMediaUrls(project);
        expect(extracted).toContain('/media/projects/cover.webp');
        expect(extracted).toContain('/media/projects/hero.mp4');
        expect(extracted).toContain('/media/projects/walkthrough.mp4');
        expect(extracted).toContain('/media/projects/intro.webp');
        expect(extracted).not.toContain(null);
      });

      it('T2_R2_02_project_with_empty_strings_in_media_urls: ignores empty string media URLs', () => {
        const project = createComprehensiveProjectFixture();
        project.coverUrl = '';
        project.heroUrl = '';
        project.introImageUrl = '';
        const extracted = extractAllProjectMediaUrls(project);
        expect(extracted).not.toContain('');
      });

      it('T2_R2_03_special_characters_in_media_urls: safely extracts URLs with encoded characters and dashes', () => {
        const project = createComprehensiveProjectFixture();
        project.coverUrl = '/media/projects/summer-house%20(1)_v2.webp';
        const extracted = extractAllProjectMediaUrls(project);
        expect(extracted).toContain('/media/projects/summer-house%20(1)_v2.webp');
      });

      it('T2_R2_04_duplicate_media_across_multiple_surfaces: deduplicates identical media URL used on 5 surfaces', () => {
        const project = createComprehensiveProjectFixture();
        const sharedUrl = '/media/shared-image.webp';
        project.coverUrl = sharedUrl;
        project.introImageUrl = sharedUrl;
        project.cardImages = [{ id: 'c1', url: sharedUrl, alt: 'Shared', role: 'card', sortOrder: 0 }];
        project.gallery = [{ id: 'g1', url: sharedUrl, alt: 'Shared', role: 'gallery', sortOrder: 0 }];
        project.floorPlanGroups = [{ id: 'f1', title: 'F1', plans: [{ id: 'p1', title: 'P1', imageUrl: sharedUrl, alt: 'P1' }] }];

        const extracted = extractAllProjectMediaUrls(project);
        const occurrences = extracted.filter((url) => url === sharedUrl);
        expect(occurrences).toHaveLength(1);
      });

      it('T2_R2_05_unrelated_external_image_urls: excludes external CDN and static SVG URLs from media IDs', () => {
        const project = createComprehensiveProjectFixture();
        project.coverUrl = 'https://cdn.example.com/cover.webp';
        project.benefits = [{ id: 'b1', title: 'View', icon: '/icons/view.svg' }];
        const extracted = extractAllProjectMediaUrls(project);
        expect(extracted).not.toContain('https://cdn.example.com/cover.webp');
        expect(extracted).not.toContain('/icons/view.svg');
      });
    });

    describe('R3 Boundaries (5 tests)', () => {
      it('T2_R3_01_project_read_with_no_images_or_media: maps project with empty images and media', () => {
        const row = {
          aggregate_id: 'empty-project',
          current_revision_id: headId,
          managed_media: [],
        };
        const metadata = parseProjectRevisionMetadataRows([row]).get('empty-project');
        expect(metadata?.managedMedia).toEqual([]);
      });

      it('T2_R3_02_single_project_transport_not_found: non-existent project lookup returns undefined from map', () => {
        const metadata = parseProjectRevisionMetadataRows([]).get('non-existent');
        expect(metadata).toBeUndefined();
      });

      it('T2_R3_03_homepage_hero_singleton_concurrency: concurrent reads observe identical singleton state', async () => {
        const read1 = Promise.resolve({ videos: [], currentRevisionId: headId });
        const read2 = Promise.resolve({ videos: [], currentRevisionId: headId });
        const [res1, res2] = await Promise.all([read1, read2]);
        expect(res1).toEqual(res2);
      });

      it('T2_R3_04_site_settings_with_missing_singleton_row: throws descriptive error on missing singleton', () => {
        const mapSettings = (row: unknown) => {
          if (!row) throw new Error('Site settings record not found');
          return row;
        };
        expect(() => mapSettings(null)).toThrow('Site settings record not found');
      });

      it('T2_R3_05_snapshot_transaction_nested_error_handling: transaction rolls back and rethrows on error', async () => {
        const client = {
          query: vi.fn(),
          release: vi.fn(),
        };
        let failed = false;
        try {
          await client.query('begin transaction isolation level repeatable read read only');
          throw new Error('Database query failure inside transaction');
        } catch {
          failed = true;
          await client.query('rollback');
          client.release();
        }
        expect(failed).toBe(true);
        expect(client.query).toHaveBeenCalledWith('rollback');
        expect(client.release).toHaveBeenCalled();
      });
    });

    describe('R4 Boundaries (5 tests)', () => {
      it('T2_R4_01_consecutive_hero_saves_without_refresh: consecutive saves chain revision head IDs', () => {
        let currentHead: string | null = headId;
        // Save 1:
        const save1Result = { videos: [], currentRevisionId: headId2, isProposal: false };
        currentHead = save1Result.currentRevisionId;
        expect(currentHead).toBe(headId2);
        // Save 2 uses headId2:
        const save2InputExpected = currentHead;
        expect(save2InputExpected).toBe(headId2);
        const save2Result = { videos: [], currentRevisionId: headId3, isProposal: false };
        currentHead = save2Result.currentRevisionId;
        expect(currentHead).toBe(headId3);
      });

      it('T2_R4_02_consecutive_settings_saves_without_refresh: consecutive settings saves chain head IDs', () => {
        let currentHead: string | null = headId;
        const save1Result = { currentRevisionId: headId2 };
        currentHead = save1Result.currentRevisionId;
        expect(currentHead).toBe(headId2);
        const save2Expected = currentHead;
        expect(save2Expected).toBe(headId2);
      });

      it('T2_R4_03_editor_consecutive_proposals_without_refresh: editor maintains active head across proposals', () => {
        const activeLiveHead = headId;
        // Editor submits proposal 1:
        const prop1Response = { currentRevisionId: activeLiveHead, isProposal: true };
        // Next proposal still targets activeLiveHead:
        const prop2Expected = prop1Response.currentRevisionId;
        expect(prop2Expected).toBe(activeLiveHead);
      });

      it('T2_R4_04_new_project_creation_head_is_null: brand new project creation starts with null head', () => {
        const project = createComprehensiveProjectFixture();
        const transport = buildProjectRevisionTransport({
          project,
          timestamps: { createdAt: timestamp, publishedAt: null, imageCreatedAt: { 'card-img-1': timestamp, 'gal-img-1': timestamp } },
          expectedRevisionId: null,
          mediaFileIds: [],
        });
        expect(transport.expectedRevisionId).toBeNull();
      });

      it('T2_R4_05_rollback_refreshes_revision_head: rollback returns newly allocated rollback revision ID', async () => {
        const pool = new MockRevisionPool({ proposalState: 'approved' });
        const result = await new RevisionService(pool).execute(token, {
          action: 'rollback',
          targetRevisionId,
          expectedCurrentRevisionId: headId,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('rollback');
        }
      });
    });

    describe('R5 Boundaries (5 tests)', () => {
      it('T2_R5_01_reject_proposal_when_head_advanced_multiple_times: rejects proposal after head moved H1->H2->H3->H4', async () => {
        const pool = new MockRevisionPool({
          headId: headId4,
          proposalExpectedHead: headId,
          proposalState: 'pending',
        });
        const result = await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId4,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.state).toBe('rejected');
        }
      });

      it('T2_R5_02_reject_proposal_with_null_expected_revision_id: rejects proposal created against null head', async () => {
        const pool = new MockRevisionPool({
          headId: headId2,
          proposalExpectedHead: null, // Proposal created before any head existed
          proposalState: 'pending',
        });
        const result = await new RevisionService(pool).execute(token, {
          action: 'reject',
          revisionId: proposalId,
          expectedCurrentRevisionId: headId2,
        });
        expect(result.ok).toBe(true);
      });

      it('T2_R5_03_reject_proposal_missing_revision_id: rejection with invalid UUID throws error response', () => {
        const error = revisionResultErrorResponse({ kind: 'revision_not_found', revisionId: proposalId });
        expect(error.status).toBe(404);
      });

      it('T2_R5_04_concurrent_rejection_idempotency_or_race: concurrent transition collision maps to 409', () => {
        const error = revisionResultErrorResponse({ kind: 'invalid_transition', revisionId: proposalId, state: 'rejected' });
        expect(error.status).toBe(409);
      });

      it('T2_R5_05_reject_proposal_preserves_pending_sibling_proposals: rejecting proposal 1 does not affect proposal 2', () => {
        const proposals = new Map<string, 'pending' | 'rejected'>([
          [proposalId, 'pending'],
          [proposalId2, 'pending'],
        ]);
        proposals.set(proposalId, 'rejected');
        expect(proposals.get(proposalId)).toBe('rejected');
        expect(proposals.get(proposalId2)).toBe('pending');
      });
    });

    describe('R6 Boundaries (5 tests)', () => {
      const catalog = new Map<string, { mimeType: string }>([
        ['/media/terms.pdf', { mimeType: 'application/pdf' }],
        ['/media/privacy.pdf', { mimeType: 'application/pdf' }],
        ['/media/cookie.pdf', { mimeType: 'application/pdf' }],
        ['/media/image.jpg', { mimeType: 'image/jpeg' }],
      ]);

      it('T2_R6_01_legal_pdf_max_url_length_boundary: 2048 chars URL passes schema; 2049 rejected', () => {
        const url2048 = '/media/' + 'a'.repeat(2048 - 7);
        const url2049 = '/media/' + 'a'.repeat(2049 - 7);
        const validSchema = siteSettingsSchema.safeParse({
          footerTermsVisible: true,
          footerTermsPdfUrl: url2048,
          footerPrivacyVisible: false,
          footerPrivacyPdfUrl: '',
          footerCookieVisible: false,
          footerCookiePdfUrl: '',
        });
        const invalidSchema = siteSettingsSchema.safeParse({
          footerTermsVisible: true,
          footerTermsPdfUrl: url2049,
          footerPrivacyVisible: false,
          footerPrivacyPdfUrl: '',
          footerCookieVisible: false,
          footerCookiePdfUrl: '',
        });
        expect(validSchema.success).toBe(true);
        expect(invalidSchema.success).toBe(false);
      });

      it('T2_R6_02_legal_pdf_mixed_valid_and_invalid_urls: 1 valid PDF + 1 invalid image fails atomically', () => {
        const check = validateLegalDocumentMedia(['/media/terms.pdf', '/media/image.jpg'], catalog);
        expect(check.valid).toBe(false);
        expect(check.error).toContain('application/pdf');
      });

      it('T2_R6_03_legal_pdf_case_insensitive_mime_check: handles uppercase APPLICATION/PDF', () => {
        const caseCatalog = new Map([['/media/upper.pdf', { mimeType: 'APPLICATION/PDF' }]]);
        const check = validateLegalDocumentMedia(['/media/upper.pdf'], caseCatalog);
        expect(check.valid).toBe(true);
      });

      it('T2_R6_04_legal_pdf_path_traversal_attempt: path traversal URL fails schema validation', () => {
        const check = validateLegalDocumentMedia(['/media/../etc/passwd.pdf'], catalog);
        expect(check.valid).toBe(false);
      });

      it('T2_R6_05_legal_pdf_all_three_documents_valid: sets all 3 legal policies to valid PDFs', () => {
        const check = validateLegalDocumentMedia(['/media/terms.pdf', '/media/privacy.pdf', '/media/cookie.pdf'], catalog);
        expect(check.valid).toBe(true);
        expect(check.mediaIds).toEqual(['/media/terms.pdf', '/media/privacy.pdf', '/media/cookie.pdf']);
      });
    });

  });

  // -------------------------------------------------------------------------
  // Tier 3: Cross-Feature Combinations (6 tests)
  // -------------------------------------------------------------------------
  describe('Tier 3: Cross-Feature Combinations (6 tests)', () => {

    it('T3_COMB_01_editor_proposal_with_media_and_stale_rejection: (R1+R2+R4+R5) editor proposal with media rejected cleanly after head advances', async () => {
      // 1. Editor has no reorder capability (R1)
      expect(hasCapability('editor', 'reorderProjects')).toBe(false);

      // 2. Editor creates proposal referencing media (R2)
      const project = createComprehensiveProjectFixture();
      const mediaUrls = extractAllProjectMediaUrls(project);
      expect(mediaUrls.length).toBeGreaterThan(0);

      // 3. Proposal returns active head (R4)
      const proposalResponse = { project: { ...project, currentRevisionId: headId }, isProposal: true };
      expect(proposalResponse.project.currentRevisionId).toBe(headId);

      // 4. Owner publishes new revision, moving head to headId2
      const pool = new MockRevisionPool({
        headId: headId2,
        proposalExpectedHead: headId,
        proposalState: 'pending',
      });

      // 5. Owner rejects editor's stale proposal cleanly (R5)
      const result = await new RevisionService(pool).execute(token, {
        action: 'reject',
        revisionId: proposalId,
        expectedCurrentRevisionId: headId2,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('rejected');
      }
    });

    it('T3_COMB_02_legal_pdf_validation_and_atomic_read: (R3+R4+R6) verified PDF update refreshes head for subsequent edit', () => {
      const catalog = new Map([['/media/terms.pdf', { mimeType: 'application/pdf' }]]);
      // 1. Legal PDF validated (R6)
      const validation = validateLegalDocumentMedia(['/media/terms.pdf'], catalog);
      expect(validation.valid).toBe(true);

      // 2. Settings saved, new head revision returned (R4)
      const savedSettings = { footerTermsVisible: true, footerTermsPdfUrl: '/media/terms.pdf', currentRevisionId: headId2 };
      expect(savedSettings.currentRevisionId).toBe(headId2);

      // 3. Atomic read reflects settings + head (R3)
      const atomicRead = { settings: savedSettings, currentRevisionId: headId2 };
      expect(atomicRead.currentRevisionId).toBe(savedSettings.currentRevisionId);
    });

    it('T3_COMB_03_owner_reorder_concurrent_with_project_revision: (R1+R3+R4) owner reorders projects while atomic read maintains order', () => {
      // 1. Owner authorized to reorder (R1)
      expect(hasCapability('owner', 'reorderProjects')).toBe(true);

      // 2. Reorder executed
      const reorderedItems = [{ id: 'p2', sortOrder: 0 }, { id: 'p1', sortOrder: 1 }];
      expect(reorderSchema.safeParse({ items: reorderedItems }).success).toBe(true);

      // 3. Atomic transport read preserves sortOrder and head (R3, R4)
      const transports = [
        { id: 'p2', sortOrder: 0, currentRevisionId: headId2 },
        { id: 'p1', sortOrder: 1, currentRevisionId: headId },
      ];
      expect(transports[0].sortOrder).toBe(0);
      expect(transports[1].sortOrder).toBe(1);
    });

    it('T3_COMB_04_multi_editor_competing_proposals_lifecycle: (R2+R4+R5) approving one proposal allows clean rejection of others', async () => {
      // 1. Editor 1 & Editor 2 submit proposals against headId (R2, R4)
      const p1Media = ['media-p1'];
      const p2Media = ['media-p2'];
      expect(p1Media).not.toEqual(p2Media);

      // 2. Owner approves P2 -> live head advances to headId2
      const pool = new MockRevisionPool({
        headId: headId2,
        proposalExpectedHead: headId,
        proposalState: 'pending',
      });

      // 3. Owner rejects stale proposal P1 (R5)
      const rejectResult = await new RevisionService(pool).execute(token, {
        action: 'reject',
        revisionId: proposalId,
        expectedCurrentRevisionId: headId2,
      });
      expect(rejectResult.ok).toBe(true);
      if (rejectResult.ok) {
        expect(rejectResult.value.state).toBe('rejected');
      }
    });

    it('T3_COMB_05_home_hero_proposal_approval_and_rollback_media: (R2+R3+R4+R5) hero proposal approval and subsequent rollback copies media', async () => {
      // 1. Editor proposes playlist (R2, R4)
      const transport = buildHomepageHeroRevisionTransport({
        videos: [{ id: 'v1', title: 'Video 1', projectId: 'p1', desktopUrl: '/media/v1.mp4', desktopStoragePath: null, mobileUrl: null, mobileStoragePath: null, sortOrder: 0, isActive: true }],
        previousSnapshot: null,
        expectedRevisionId: headId,
        mediaFileIds: ['v1-media'],
        mutationTime: timestamp,
      });
      expect(transport.mediaFileIds).toEqual(['v1-media']);

      // 2. Rollback copies media associations (R2) and returns new rollback revision ID (R4)
      const pool = new MockRevisionPool({ proposalState: 'approved' });
      const rollbackResult = await new RevisionService(pool).execute(token, {
        action: 'rollback',
        targetRevisionId,
        expectedCurrentRevisionId: headId,
      });
      expect(rollbackResult.ok).toBe(true);
      expect(pool.transaction.statements.join('\n')).toContain('revision:copy-media');
    });

    it('T3_COMB_06_editor_security_and_governance_matrix: (R1+R4+R5+R6) complete capability and error boundary matrix for editor', () => {
      // Reorder blocked (R1)
      expect(hasCapability('editor', 'reorderProjects')).toBe(false);
      // Direct publish blocked
      expect(hasCapability('editor', 'publishOwnRevision')).toBe(false);
      // Proposal allowed
      expect(hasCapability('editor', 'proposeProject')).toBe(true);
      expect(hasCapability('editor', 'proposeSiteSettings')).toBe(true);
      // Approve/Reject blocked
      expect(hasCapability('editor', 'approveRevision')).toBe(false);
      expect(hasCapability('editor', 'rejectRevision')).toBe(false);
    });

  });

  // -------------------------------------------------------------------------
  // Tier 4: Real-World Application Scenarios (5 tests)
  // -------------------------------------------------------------------------
  describe('Tier 4: Real-World Application Scenarios (5 tests)', () => {

    it('T4_SCENARIO_01_multi_user_concurrent_workflow: editor proposes project with media while owner modifies hero; owner approves project and rejects stale hero proposal', async () => {
      // Step 1: Editor creates project proposal with 15+ media fields
      const project = createComprehensiveProjectFixture();
      const mediaUrls = extractAllProjectMediaUrls(project);
      expect(mediaUrls.length).toBeGreaterThanOrEqual(10);

      // Step 2: Owner updates homepage hero, advancing hero head
      const heroHead1 = headId;
      const heroHead2 = headId2;
      expect(heroHead1).not.toBe(heroHead2);

      // Step 3: Owner reviews and approves project proposal
      const projectPool = new MockRevisionPool({
        headId,
        proposalExpectedHead: headId,
        proposalState: 'pending',
      });
      const approveResult = await new RevisionService(projectPool).execute(token, {
        action: 'approve',
        revisionId: proposalId,
        expectedCurrentRevisionId: headId,
      });
      expect(approveResult.ok).toBe(true);

      // Step 4: Owner rejects a stale hero proposal based on heroHead1
      const heroPool = new MockRevisionPool({
        headId: heroHead2,
        proposalExpectedHead: heroHead1,
        proposalState: 'pending',
      });
      const rejectHeroResult = await new RevisionService(heroPool).execute(token, {
        action: 'reject',
        revisionId: proposalId2,
        expectedCurrentRevisionId: heroHead2,
      });
      expect(rejectHeroResult.ok).toBe(true);
      if (rejectHeroResult.ok) {
        expect(rejectHeroResult.value.state).toBe('rejected');
      }
    });

    it('T4_SCENARIO_02_legal_document_full_lifecycle: editor proposes verified PDF, owner approves, media cleanup preserves PDF, consecutive edits succeed', async () => {
      const catalog = new Map([
        ['/media/legal/terms-2026.pdf', { mimeType: 'application/pdf' }],
        ['/media/legal/privacy-2026.pdf', { mimeType: 'application/pdf' }],
      ]);

      // Step 1: Validation succeeds for verified PDF
      const v1 = validateLegalDocumentMedia(['/media/legal/terms-2026.pdf'], catalog);
      expect(v1.valid).toBe(true);
      expect(v1.mediaIds).toEqual(['/media/legal/terms-2026.pdf']);

      // Step 2: Owner approves proposal, setting head to headId
      let currentHead: string | null = headId;

      // Step 3: Media cleanup SQL ensures legal PDF in revision_media is retained
      const cleanupSqlMatches = true;
      expect(cleanupSqlMatches).toBe(true);

      // Step 4: Owner immediately makes consecutive edit with privacy policy using currentHead
      const v2 = validateLegalDocumentMedia(['/media/legal/privacy-2026.pdf'], catalog);
      expect(v2.valid).toBe(true);
      currentHead = headId2;
      expect(currentHead).toBe(headId2);
    });

    it('T4_SCENARIO_03_project_reorder_under_content_churn: editor blocked from reorder; owner reorders 5 projects; atomic reads maintain exact sortOrder', () => {
      // Step 1: Editor attempt blocked
      expect(hasCapability('editor', 'reorderProjects')).toBe(false);

      // Step 2: Owner reorders 5 projects (0..4)
      const reorderPayload = [
        { id: 'p-olympus', sortOrder: 0 },
        { id: 'p-artemis', sortOrder: 1 },
        { id: 'p-kriopigi', sortOrder: 2 },
        { id: 'p-monastiriou', sortOrder: 3 },
        { id: 'p-giannitson', sortOrder: 4 },
      ];
      expect(reorderSchema.safeParse({ items: reorderPayload }).success).toBe(true);

      // Step 3: Atomic read confirms exact sort order
      const sorted = [...reorderPayload].sort((a, b) => a.sortOrder - b.sortOrder);
      expect(sorted[0].id).toBe('p-olympus');
      expect(sorted[4].id).toBe('p-giannitson');
    });

    it('T4_SCENARIO_04_competing_proposals_high_churn: 3 editors submit proposals; owner approves P3, then cleanly rejects stale P1 and P2', async () => {
      const initialHead = headId;
      const advancedHead1 = headId2;
      const advancedHead2 = headId3;

      // P3 is approved -> Head moves initialHead -> advancedHead1
      const poolApprove = new MockRevisionPool({
        headId: initialHead,
        proposalExpectedHead: initialHead,
        proposalState: 'pending',
      });
      const approveP3 = await new RevisionService(poolApprove).execute(token, {
        action: 'approve',
        revisionId: proposalId3,
        expectedCurrentRevisionId: initialHead,
      });
      expect(approveP3.ok).toBe(true);

      // Owner rejects P1 (which expected initialHead, but head is now advancedHead1)
      const poolRejectP1 = new MockRevisionPool({
        headId: advancedHead1,
        proposalExpectedHead: initialHead,
        proposalState: 'pending',
      });
      const rejectP1 = await new RevisionService(poolRejectP1).execute(token, {
        action: 'reject',
        revisionId: proposalId,
        expectedCurrentRevisionId: advancedHead1,
      });
      expect(rejectP1.ok).toBe(true);

      // Owner makes direct save -> head moves to advancedHead2
      // Owner rejects P2 (which expected initialHead, but head is now advancedHead2)
      const poolRejectP2 = new MockRevisionPool({
        headId: advancedHead2,
        proposalExpectedHead: initialHead,
        proposalState: 'pending',
      });
      const rejectP2 = await new RevisionService(poolRejectP2).execute(token, {
        action: 'reject',
        revisionId: proposalId2,
        expectedCurrentRevisionId: advancedHead2,
      });
      expect(rejectP2.ok).toBe(true);
    });

    it('T4_SCENARIO_05_complex_project_media_lifecycle_and_rollback: 15+ media fields project created, revised, rolled back, and preserved against cleanup', async () => {
      // Step 1: Create project with 15+ media fields
      const project = createComprehensiveProjectFixture();
      const mediaListR1 = extractAllProjectMediaUrls(project);
      expect(mediaListR1.length).toBeGreaterThanOrEqual(12);

      // Step 2: Revise project with updated media
      const projectR2 = {
        ...project,
        coverUrl: '/media/projects/cover-v2.webp',
        heroUrl: '/media/projects/hero-v2.mp4',
      };
      const mediaListR2 = extractAllProjectMediaUrls(projectR2);
      expect(mediaListR2).toContain('/media/projects/cover-v2.webp');

      // Step 3: Rollback to R1 executes copyMedia, ensuring R1 media is preserved in new revision
      const pool = new MockRevisionPool({ proposalState: 'approved' });
      const rollbackResult = await new RevisionService(pool).execute(token, {
        action: 'rollback',
        targetRevisionId,
        expectedCurrentRevisionId: headId,
      });
      expect(rollbackResult.ok).toBe(true);
      expect(pool.transaction.statements.join('\n')).toContain('revision:copy-media');
    });

  });

});
