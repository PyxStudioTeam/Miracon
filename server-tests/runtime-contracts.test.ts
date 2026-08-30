import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedProjects } from '../src/data/projects';
import { fallbackHomeHeroVideos, getHomeHeroVideos } from '../src/lib/home-hero';
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
