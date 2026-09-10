import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedProjects } from '../src/data/projects';
import { fallbackHomeHeroVideos, getHomeHeroVideos } from '../src/lib/home-hero';
import {
  SiteOriginConfigurationError,
  getPublicIdentityRedirect,
  parseSiteOrigin,
  resolveSiteRuntime,
} from '../src/lib/site-origin';
import { mapProjectRow } from '../src/lib/projects';
import { projectSchema, siteSettingsSchema } from '../src/lib/server/api-schemas';

vi.mock('../src/lib/server/database', () => ({
  getDatabasePool: () => ({}),
}));

vi.mock('../src/lib/server/homepage-videos', () => ({
  getActiveHomepageVideos: () => Promise.resolve([]),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('runtime contracts', () => {
  it('requires nullable nonnegative integer project availability', () => {
    // Given
    const project = seedProjects[0];
    if (!project) throw new Error('Project schema fixture is required');

    // When
    const accepted = [null, 0, 2].map((remainingUnits) => projectSchema.safeParse({ ...project, remainingUnits }));
    const rejected = [
      projectSchema.safeParse({ ...project, remainingUnits: -1 }),
      projectSchema.safeParse({ ...project, remainingUnits: 1.5 }),
      projectSchema.safeParse(({ ...project, remainingUnits: undefined })),
    ];

    // Then
    expect(accepted.every((result) => result.success)).toBe(true);
    expect(rejected.every((result) => !result.success)).toBe(true);
  });

  it('uses truthful remaining-unit values in project seeds', () => {
    // Given / When
    const availability = Object.fromEntries(seedProjects.map((project) => [project.slug, project.remainingUnits]));

    // Then
    expect(availability).toEqual({
      'artemis-residences': 2,
      'giannitson-thessaloniki': null,
      'kriopigi-villas': null,
      'monastiriou-4-residences': null,
      'olympus-sea-view': null,
    });
  });

  it('uses URL-safe brochure paths in project seeds', () => {
    // Given / When
    const brochures = Object.fromEntries(seedProjects.map((project) => [project.slug, project.brochureUrl]));

    // Then
    expect(brochures['artemis-residences']).toBe('/brochures/a4-artemis-compressed.pdf');
    expect(brochures['kriopigi-villas']).toBe('/brochures/kriopigi-villas-compressed.pdf');
  });

  it('accepts only an HTTPS origin for production public identity', () => {
    // Given / When
    const origin = parseSiteOrigin('https://miracon.gr', 'production');

    // Then
    expect(origin.href).toBe('https://miracon.gr/');
  });

  it.each([
    undefined,
    '',
    'http://miracon.gr',
    'https://127.0.0.1:4321',
    'https://localhost:4321',
    'https://example.com',
    'https://www.miracon.gr',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.1.1',
    'https://miracon.gr:444',
    'https://miracon.gr/path',
    'https://miracon.gr?campaign=test',
  ])('rejects unsafe production PUBLIC_SITE_URL value %s', (configuredUrl) => {
    // Given / When / Then
    expect(() => parseSiteOrigin(configuredUrl, 'production')).toThrow(SiteOriginConfigurationError);
  });

  it('accepts onrender.com preview origins when RENDER or ALLOW_PREVIEW_HOSTS is enabled', () => {
    // Given
    const originalRender = process.env.RENDER;
    const originalPreview = process.env.ALLOW_PREVIEW_HOSTS;
    try {
      process.env.RENDER = 'true';
      // When / Then
      const origin = parseSiteOrigin('https://miracon-preview.onrender.com', 'production');
      expect(origin.href).toBe('https://miracon-preview.onrender.com/');

      delete process.env.RENDER;
      process.env.ALLOW_PREVIEW_HOSTS = 'true';
      const previewOrigin = parseSiteOrigin('https://staging.miracon.preview', 'production');
      expect(previewOrigin.href).toBe('https://staging.miracon.preview/');
    } finally {
      if (originalRender === undefined) delete process.env.RENDER;
      else process.env.RENDER = originalRender;
      if (originalPreview === undefined) delete process.env.ALLOW_PREVIEW_HOSTS;
      else process.env.ALLOW_PREVIEW_HOSTS = originalPreview;
    }
  });

  it('keeps production build mode authoritative over test runtime markers', () => {
    // Given / When
    const runtime = resolveSiteRuntime({
      isProductionBuild: true,
      mode: 'test',
      nodeEnvironment: 'test',
    });

    // Then
    expect(runtime).toBe('production');
  });

  it('allows a loopback HTTP origin only for development and test', () => {
    // Given / When
    const developmentOrigin = parseSiteOrigin('http://127.0.0.1:4321', 'development');
    const testOrigin = parseSiteOrigin('http://localhost:4321', 'test');

    // Then
    expect(developmentOrigin.origin).toBe('http://127.0.0.1:4321');
    expect(testOrigin.origin).toBe('http://localhost:4321');
  });

  it.each([
    '/',
    '/el/?campaign=locale',
    '/api/health?probe=api',
    '/media/uploads/file.pdf?download=1',
    '/admin?next=users',
    '/preview/project?mode=desktop',
    '/el/preview/project?mode=mobile',
  ])('redirects www requests for %s to the configured apex without changing path or query', (path) => {
    // Given
    const requestUrl = new URL(path, 'https://www.miracon.gr');
    const canonicalOrigin = parseSiteOrigin('https://miracon.gr', 'production');

    // When
    const redirect = getPublicIdentityRedirect(requestUrl, canonicalOrigin);

    // Then
    expect(redirect).toBe(`https://miracon.gr${path}`);
  });

  it('does not redirect apex or unrelated hosts', () => {
    // Given
    const canonicalOrigin = parseSiteOrigin('https://miracon.gr', 'production');

    // When
    const apexRedirect = getPublicIdentityRedirect(new URL('https://miracon.gr/projects'), canonicalOrigin);
    const unrelatedRedirect = getPublicIdentityRedirect(new URL('https://example.com/projects'), canonicalOrigin);

    // Then
    expect(apexRedirect).toBeNull();
    expect(unrelatedRedirect).toBeNull();
  });

  it.each([
    ['/brochures/A4 Artemis_compressed.pdf', '/brochures/a4-artemis-compressed.pdf'],
    ['/brochures/A4%20Artemis_compressed.pdf', '/brochures/a4-artemis-compressed.pdf'],
    ['/brochures/Kriopigi Villas_compressed.pdf', '/brochures/kriopigi-villas-compressed.pdf'],
    ['/brochures/Kriopigi%20Villas_compressed.pdf', '/brochures/kriopigi-villas-compressed.pdf'],
  ])('normalizes stored legacy brochure URL %s at the project read boundary', (storedUrl, expectedUrl) => {
    // Given
    const row = { id: 'legacy-project', slug: 'legacy-project', title: 'Legacy project', brochure_url: storedUrl };

    // When
    const project = mapProjectRow(row);

    // Then
    expect(project.brochureUrl).toBe(expectedUrl);
  });

  it('redirects only the two former brochure paths', () => {
    // Given
    const canonicalOrigin = parseSiteOrigin('https://miracon.gr', 'production');

    // When
    const artemis = getPublicIdentityRedirect(new URL('https://miracon.gr/brochures/A4%20Artemis_compressed.pdf?download=1'), canonicalOrigin);
    const unrelated = getPublicIdentityRedirect(new URL('https://miracon.gr/brochures/Other%20Brochure.pdf'), canonicalOrigin);

    // Then
    expect(artemis).toBe('/brochures/a4-artemis-compressed.pdf?download=1');
    expect(unrelated).toBeNull();
  });

  it('combines www canonicalization and a legacy brochure migration in one redirect', () => {
    // Given
    const canonicalOrigin = parseSiteOrigin('https://miracon.gr', 'production');
    const legacyUrl = new URL('https://www.miracon.gr/brochures/Kriopigi%20Villas_compressed.pdf?download=1');

    // When
    const redirect = getPublicIdentityRedirect(legacyUrl, canonicalOrigin);

    // Then
    expect(redirect).toBe('https://miracon.gr/brochures/kriopigi-villas-compressed.pdf?download=1');
  });

  it('accepts local media legal documents and rejects other relative URLs', () => {
    // Given
    const settings = {
      footerTermsVisible: true,
      footerTermsPdfUrl: '/media/legal/terms.pdf',
      footerPrivacyVisible: false,
      footerPrivacyPdfUrl: '',
      footerCookieVisible: false,
      footerCookiePdfUrl: '',
    };

    // When
    const localDocument = siteSettingsSchema.safeParse(settings);
    const unrelatedRelativeUrl = siteSettingsSchema.safeParse({ ...settings, footerTermsPdfUrl: '/documents/terms.pdf' });

    // Then
    expect(localDocument.success).toBe(true);
    expect(unrelatedRelativeUrl.success).toBe(false);
  });

  it('uses bundled videos when the active database playlist is empty', async () => {
    // Given
    process.env.DATABASE_URL = 'postgres://configured-at-runtime';

    // When
    const videos = await getHomeHeroVideos();

    // Then
    expect(videos).toEqual(fallbackHomeHeroVideos);
  });
});
