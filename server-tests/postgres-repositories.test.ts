import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedProjects } from '../src/data/projects';
import type { Project } from '../src/lib/project-types';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { DATABASE_POOL_MAX_CONNECTIONS, createDatabasePool } from '../src/lib/server/database';
import {
  deleteProject,
  getAdminProjects,
  getPublishedProjects,
  reorderProjects,
  saveProject,
} from '../src/lib/server/projects';
import {
  getActiveHomepageVideos,
  getHomepageVideos,
  replaceHomepageVideos,
} from '../src/lib/server/homepage-videos';
import { getSiteSettings, updateSiteSettings } from '../src/lib/server/site-settings';

const databaseUrl = requireSafeDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
const pool = createDatabasePool();

beforeAll(async () => {
  const resetPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await resetPool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await resetPool.end();
  await migrate(databaseUrl);
}, 30_000);

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL projects repository', () => {
  it('creates a bounded pool from DATABASE_URL', () => {
    // Given / When / Then
    expect(DATABASE_POOL_MAX_CONNECTIONS).toBe(10);
  });

  it('reads published projects in order while the admin read includes drafts', async () => {
    // Given
    const published = projectFixture('server-published', 'server-published', 'published', 2);
    const draft = projectFixture('server-draft', 'server-draft', 'draft', 1);
    await saveProject(pool, published);
    await saveProject(pool, draft);

    // When
    const publicProjects = await getPublishedProjects(pool);
    const adminProjects = await getAdminProjects(pool);

    // Then
    expect(publicProjects.map((project) => project.id)).toEqual(['server-published']);
    expect(adminProjects.map((project) => project.id)).toEqual(['server-draft', 'server-published']);
    expect(adminProjects[0]?.gallery.map((image) => image.id)).toEqual(['server-draft-gallery']);
  });

  it('saves, reorders, and deletes through the atomic SQL functions', async () => {
    // Given
    const first = projectFixture('server-first', 'server-first', 'draft', 0);
    const second = projectFixture('server-second', 'server-second', 'draft', 1);
    await saveProject(pool, first);
    await saveProject(pool, second);

    // When
    await reorderProjects(pool, [
      { id: first.id, sortOrder: 1 },
      { id: second.id, sortOrder: 0 },
    ]);
    await deleteProject(pool, first.id);
    const projects = await getAdminProjects(pool);

    // Then
    expect(projects.map((project) => project.id)).toEqual(['server-second', 'server-draft', 'server-published']);
    expect(projects.some((project) => project.id === first.id)).toBe(false);
  });

  it('round-trips stored media, translations, images, and timestamps', async () => {
    // Given
    const project = {
      ...projectFixture('server-round-trip', 'server-round-trip', 'draft', 3),
      heroType: 'video' as const,
      heroVariant: 'immersive' as const,
      heroIdleUi: false,
      heroUrl: '/media/legacy-hero.mp4',
      heroMobileUrl: '/media/legacy-hero-mobile.mp4',
      heroPosterUrl: '/media/legacy-hero.webp',
      heroVideos: [
        { id: 'server-round-trip-hero-1', desktopUrl: '/media/legacy-hero.mp4', mobileUrl: '/media/legacy-hero-mobile.mp4', posterUrl: '/media/legacy-hero.webp' },
        { id: 'server-round-trip-hero-2', desktopUrl: '/media/hero-second.mp4', mobileUrl: null, posterUrl: null },
      ],
      walkthroughVideoEnabled: true,
      walkthroughVideoTitle: 'Guided walkthrough',
      walkthroughVideoDesktopUrl: '/media/legacy-walkthrough.mp4',
      walkthroughVideoMobileUrl: '/media/legacy-walkthrough-mobile.mp4',
      walkthroughVideoPosterUrl: '/media/legacy-walkthrough.webp',
      walkthroughVideos: [
        { id: 'server-round-trip-walkthrough-1', desktopUrl: '/media/legacy-walkthrough.mp4', mobileUrl: '/media/legacy-walkthrough-mobile.mp4', posterUrl: '/media/legacy-walkthrough.webp' },
        { id: 'server-round-trip-walkthrough-2', desktopUrl: '/media/walkthrough-second.mp4', mobileUrl: null, posterUrl: null },
      ],
      cardImages: [{ id: 'server-round-trip-card', url: '/media/card.webp', storagePath: 'projects/server-round-trip/card.webp', alt: 'Card', role: 'card' as const, sortOrder: 0, width: 1_200, height: 800, focalX: 35, focalY: 65 }],
      gallery: [{ id: 'server-round-trip-gallery', url: '/media/gallery.webp', storagePath: 'projects/server-round-trip/gallery.webp', alt: 'Gallery', role: 'gallery' as const, sortOrder: 0, width: 1_600, height: 900, focalX: 45, focalY: 55 }],
      translations: { el: { title: 'Ελληνικός τίτλος', imageAlts: { 'server-round-trip-card': 'Ελληνική κάρτα' } } },
    };

    // When
    await saveProject(pool, project);
    const stored = (await getAdminProjects(pool)).find((candidate) => candidate.id === project.id);

    // Then
    expect(stored?.heroIdleUi).toBe(false);
    expect(stored?.heroVideos).toEqual(project.heroVideos);
    expect(stored?.walkthroughVideos).toEqual(project.walkthroughVideos);
    expect(stored?.heroUrl).toBe(project.heroUrl);
    expect(stored?.walkthroughVideoDesktopUrl).toBe(project.walkthroughVideoDesktopUrl);
    expect(stored?.translations).toEqual(project.translations);
    expect(stored?.cardImages).toEqual(project.cardImages);
    expect(stored?.gallery).toEqual(project.gallery);
    expect(stored?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('round-trips null, zero, and positive remaining units distinctly', async () => {
    // Given
    const projects = ([null, 0, 7] as const).map((remainingUnits, index) => ({
      ...projectFixture(`server-availability-${index}`, `server-availability-${index}`, 'draft', 10 + index),
      remainingUnits,
    }));

    // When
    const saved = await Promise.all(projects.map((project) => saveProject(pool, project)));

    // Then
    expect(saved.map((project) => project.remainingUnits)).toEqual([null, 0, 7]);
  });

  it('retains JSON playlists when legacy video fields are empty', async () => {
    // Given
    const project = {
      ...projectFixture('server-playlists-only', 'server-playlists-only', 'draft', 4),
      heroType: 'video' as const,
      heroVariant: 'immersive' as const,
      heroUrl: '',
      heroMobileUrl: null,
      heroPosterUrl: null,
      heroVideos: [{ id: 'server-playlists-only-hero', desktopUrl: '/media/playlist-hero.mp4', mobileUrl: null, posterUrl: null }],
      walkthroughVideoDesktopUrl: '',
      walkthroughVideoMobileUrl: null,
      walkthroughVideoPosterUrl: null,
      walkthroughVideos: [{ id: 'server-playlists-only-walkthrough', desktopUrl: '/media/playlist-walkthrough.mp4', mobileUrl: null, posterUrl: null }],
    };

    // When
    await saveProject(pool, project);
    const stored = (await getAdminProjects(pool)).find((candidate) => candidate.id === project.id);

    // Then
    expect(stored?.heroVideos).toEqual(project.heroVideos);
    expect(stored?.walkthroughVideos).toEqual(project.walkthroughVideos);
    expect(stored?.heroUrl).toBe('');
    expect(stored?.walkthroughVideoDesktopUrl).toBe('');
  });
});

describe('PostgreSQL homepage videos repository', () => {
  it('returns active and full playlists in stored order after atomic replacement', async () => {
    // Given
    const playlist = [
      { id: 'server-active', title: 'Active', projectId: null, desktopUrl: '/media/active.mp4', desktopStoragePath: null, mobileUrl: null, mobileStoragePath: null, sortOrder: 1, isActive: true },
      { id: 'server-hidden', title: 'Hidden', projectId: null, desktopUrl: '/media/hidden.mp4', desktopStoragePath: null, mobileUrl: null, mobileStoragePath: null, sortOrder: 0, isActive: false },
    ];

    // When
    await replaceHomepageVideos(pool, playlist);
    const active = await getActiveHomepageVideos(pool);
    const all = await getHomepageVideos(pool);

    // Then
    expect(active.map((video) => video.id)).toEqual(['server-active']);
    expect(all.map((video) => video.id)).toEqual(['server-hidden', 'server-active']);
  });
});

describe('PostgreSQL site settings repository', () => {
  it('returns and atomically updates the singleton settings row', async () => {
    // Given
    const settings = {
      footerTermsVisible: true,
      footerTermsPdfUrl: 'https://example.com/terms.pdf',
      footerPrivacyVisible: true,
      footerPrivacyPdfUrl: 'https://example.com/privacy.pdf',
      footerCookieVisible: false,
      footerCookiePdfUrl: '',
    };

    // When
    const updated = await updateSiteSettings(pool, settings);
    const loaded = await getSiteSettings(pool);

    // Then
    expect(updated).toEqual(settings);
    expect(loaded).toEqual(settings);
  });
});

function projectFixture(id: string, slug: string, status: Project['status'], sortOrder: number): Project {
  const source = seedProjects[0];
  if (!source) throw new Error('Project fixture source is required');
  return {
    ...structuredClone(source),
    id,
    slug,
    status,
    sortOrder,
    cardImages: [{ id: `${id}-card`, url: '/media/card.webp', alt: 'Card', role: 'card', sortOrder: 0 }],
    gallery: [{ id: `${id}-gallery`, url: '/media/gallery.webp', alt: 'Gallery', role: 'gallery', sortOrder: 0 }],
  };
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  const resetAllowed = process.env.DATABASE_TEST_ALLOW_RESET === '1';
  if (!value || !resetAllowed || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}
