import { describe, expect, it } from 'vitest';
import { seedProjects } from '../src/data/projects';
import type { Project } from '../src/lib/project-types';
import {
  buildDeletedProjectSnapshot,
  buildProjectRevisionTransport,
  type ProjectRevisionTransportInput,
} from '../src/lib/server/project-revision-adapter';
import { createProposalInputSchema, projectSnapshotSchema } from '../src/lib/server/revision-contracts';

const projectId = 'adapter-project';
const headId = '4c4e0a24-0e6a-4f37-91f0-813768e0a7da';
const createdAt = '2025-01-02T03:04:05.000Z';
const updatedAt = '2025-02-03T04:05:06.000Z';
const publishedAt = '2025-03-04T05:06:07.000Z';
const imageCreatedAt = {
  'card-a': '2025-01-03T03:04:05.000Z',
  'card-z': '2025-01-04T03:04:05.000Z',
  'gallery-a': '2025-01-05T03:04:05.000Z',
  'gallery-b': '2025-01-06T03:04:05.000Z',
} as const;

function projectFixture(): Project {
  const seed = seedProjects[0];
  if (!seed) throw new Error('Project seed fixture is required');
  return {
    ...structuredClone(seed),
    id: projectId,
    slug: 'adapter-slug',
    title: 'Adapter title',
    address: 'Adapter address',
    cardAddress: 'Adapter card address',
    price: '321 000 EUR',
    remainingUnits: 7,
    shortDescription: 'Adapter short description',
    fullDescription: 'Adapter full description',
    introTitle: 'Adapter intro title',
    categories: ['city', 'golden-visa'],
    status: 'draft',
    sortOrder: 4,
    coverUrl: '/media/cover.webp',
    coverFocalX: 41,
    coverFocalY: 62,
    imageVariants: { version: 1, images: { '/media/cover.webp': { width: 1200, height: 800 } } },
    heroType: 'video',
    heroVariant: 'immersive',
    heroSoundEnabled: true,
    heroIdleUi: false,
    heroUrl: '/media/hero.mp4',
    heroMobileUrl: null,
    heroPosterUrl: '/media/hero-poster.webp',
    heroVideos: [{ id: 'hero-1', desktopUrl: '/media/hero.mp4', mobileUrl: null, posterUrl: '/media/hero-poster.webp' }],
    walkthroughVideoEnabled: true,
    walkthroughVideoTitle: 'Adapter walkthrough',
    walkthroughVideoDesktopUrl: '/media/walkthrough.mp4',
    walkthroughVideoMobileUrl: '/media/walkthrough-mobile.mp4',
    walkthroughVideoPosterUrl: '/media/walkthrough.webp',
    walkthroughVideos: [{ id: 'walkthrough-1', desktopUrl: '/media/walkthrough.mp4', mobileUrl: '/media/walkthrough-mobile.mp4', posterUrl: '/media/walkthrough.webp' }],
    heroFocalX: 37,
    heroFocalY: 58,
    introImageUrl: '/media/intro.webp',
    brochureUrl: '/media/brochure.pdf',
    mapQuery: '40.1,22.2',
    mapUrl: 'https://maps.example/adapter',
    cardImages: [
      { id: 'card-z', url: '/media/card-z.webp', alt: 'Card Z', role: 'card', sortOrder: 2 },
      { id: 'card-a', url: '/media/card-a.webp', storagePath: 'projects/card-a.webp', alt: 'Card A', role: 'card', sortOrder: 1, width: 800, height: 600, focalX: 44, focalY: 55 },
    ],
    gallery: [
      { id: 'gallery-b', url: '/media/gallery-b.webp', alt: 'Gallery B', role: 'gallery', sortOrder: 0 },
      { id: 'gallery-a', url: '/media/gallery-a.webp', alt: 'Gallery A', role: 'gallery', sortOrder: 0 },
    ],
    characteristics: [{ id: 'area', label: 'Area', value: '92 m2', icon: 'area' }],
    benefits: [{ id: 'view', title: 'Open view', icon: '/icons/view.svg' }],
    floorPlanGroups: [{ id: 'group-1', title: 'Group 1', plans: [{ id: 'plan-1', title: 'Plan 1', imageUrl: '/media/plan.webp', alt: 'Plan' }] }],
    nearbyPlaces: ['Beach', 'Airport'],
    seoTitle: '',
    seoDescription: '',
    translations: { el: { title: 'Adapter Greek title', imageAlts: { 'card-a': 'Greek Card A' } } },
    updatedAt,
  };
}

function transportInput(project: Project = projectFixture()): ProjectRevisionTransportInput {
  return {
    project,
    timestamps: { createdAt, publishedAt: null, imageCreatedAt },
    expectedRevisionId: headId,
    mediaFileIds: ['media-z', 'media-a'],
  };
}

describe('project revision adapter', () => {
  it('maps every canonical project field for a draft snapshot', () => {
    // Given
    const project = projectFixture();

    // When
    const transport = buildProjectRevisionTransport(transportInput(project));

    // Then
    expect(transport.aggregateType).toBe('project');
    expect(transport.aggregateId).toBe(project.id);
    expect(transport.snapshot.project).toEqual({
      id: project.id, slug: project.slug, title: project.title, address: project.address, card_address: project.cardAddress,
      price: project.price, remaining_units: project.remainingUnits, short_description: project.shortDescription,
      full_description: project.fullDescription, intro_title: project.introTitle, categories: project.categories,
      status: 'draft', sort_order: project.sortOrder, cover_url: project.coverUrl, cover_focal_x: project.coverFocalX,
      cover_focal_y: project.coverFocalY, image_variants: project.imageVariants, hero_type: project.heroType,
      hero_variant: project.heroVariant, hero_sound_enabled: project.heroSoundEnabled, hero_idle_ui: project.heroIdleUi,
      hero_url: project.heroUrl, hero_mobile_url: project.heroMobileUrl, hero_poster_url: project.heroPosterUrl,
      hero_videos: project.heroVideos, walkthrough_video_enabled: project.walkthroughVideoEnabled,
      walkthrough_video_title: project.walkthroughVideoTitle, walkthrough_video_desktop_url: project.walkthroughVideoDesktopUrl,
      walkthrough_video_mobile_url: project.walkthroughVideoMobileUrl, walkthrough_video_poster_url: project.walkthroughVideoPosterUrl,
      walkthrough_videos: project.walkthroughVideos, hero_focal_x: project.heroFocalX, hero_focal_y: project.heroFocalY,
      intro_image_url: project.introImageUrl, brochure_url: project.brochureUrl, map_query: project.mapQuery,
      map_url: project.mapUrl, characteristics: project.characteristics, benefits: project.benefits,
      floor_plan_groups: project.floorPlanGroups, nearby_places: project.nearbyPlaces, translations: project.translations,
      seo_title: `${project.title} - MIRACON`, seo_description: project.shortDescription,
      published_at: null, created_at: createdAt, updated_at: project.updatedAt,
    });
    expect(projectSnapshotSchema.parse(transport.snapshot)).toEqual(transport.snapshot);
    expect(createProposalInputSchema.parse(transport)).toEqual(transport);
  });

  it('canonicalizes complete image rows by role, sort order, and id', () => {
    // Given
    const input = transportInput();

    // When
    const images = buildProjectRevisionTransport(input).snapshot.images;

    // Then
    expect(images).toEqual([
      { id: 'card-a', project_id: projectId, url: '/media/card-a.webp', storage_path: 'projects/card-a.webp', alt: 'Card A', role: 'card', sort_order: 1, width: 800, height: 600, focal_x: 44, focal_y: 55, created_at: imageCreatedAt['card-a'] },
      { id: 'card-z', project_id: projectId, url: '/media/card-z.webp', storage_path: null, alt: 'Card Z', role: 'card', sort_order: 2, width: null, height: null, focal_x: 50, focal_y: 50, created_at: imageCreatedAt['card-z'] },
      { id: 'gallery-a', project_id: projectId, url: '/media/gallery-a.webp', storage_path: null, alt: 'Gallery A', role: 'gallery', sort_order: 0, width: null, height: null, focal_x: 50, focal_y: 50, created_at: imageCreatedAt['gallery-a'] },
      { id: 'gallery-b', project_id: projectId, url: '/media/gallery-b.webp', storage_path: null, alt: 'Gallery B', role: 'gallery', sort_order: 0, width: null, height: null, focal_x: 50, focal_y: 50, created_at: imageCreatedAt['gallery-b'] },
    ]);
  });

  it('preserves published status and the explicit publication timestamp', () => {
    // Given
    const project: Project = { ...projectFixture(), status: 'published' };
    const input: ProjectRevisionTransportInput = {
      ...transportInput(project),
      timestamps: { createdAt, publishedAt, imageCreatedAt },
    };

    // When
    const row = buildProjectRevisionTransport(input).snapshot.project;

    // Then
    expect(row?.status).toBe('published');
    expect(row?.published_at).toBe(publishedAt);
  });

  it('normalizes supplied timestamps to materializer readback precision', () => {
    // Given
    const project: Project = { ...projectFixture(), updatedAt: '2025-02-03T04:05:06Z' };
    const input: ProjectRevisionTransportInput = {
      ...transportInput(project),
      timestamps: {
        createdAt: '2025-01-02T03:04:05Z',
        publishedAt: null,
        imageCreatedAt: Object.fromEntries(Object.keys(imageCreatedAt).map((id) => [id, '2025-01-03T03:04:05Z'])),
      },
    };

    // When
    const snapshot = buildProjectRevisionTransport(input).snapshot;

    // Then
    expect(snapshot.project?.created_at).toBe('2025-01-02T03:04:05.000Z');
    expect(snapshot.project?.updated_at).toBe('2025-02-03T04:05:06.000Z');
    expect(snapshot.images.every((image) => image.created_at === '2025-01-03T03:04:05.000Z')).toBe(true);
  });

  it('deduplicates and sorts only explicitly supplied media file IDs', () => {
    // Given
    const input: ProjectRevisionTransportInput = {
      ...transportInput(),
      mediaFileIds: ['media-z', 'media-a', 'media-z', 'media-m'],
    };

    // When
    const transport = buildProjectRevisionTransport(input);

    // Then
    expect(transport.mediaFileIds).toEqual(['media-a', 'media-m', 'media-z']);
    expect(transport.mediaFileIds).not.toContain(projectId);
    expect(transport.mediaFileIds).not.toContain('card-a');
  });

  it('carries a null expected revision for a new project', () => {
    // Given
    const input: ProjectRevisionTransportInput = { ...transportInput(), expectedRevisionId: null };

    // When
    const transport = buildProjectRevisionTransport(input);

    // Then
    expect(transport.expectedRevisionId).toBeNull();
    expect(createProposalInputSchema.safeParse(transport).success).toBe(true);
  });

  it('rejects a snapshot when an image creation timestamp is absent', () => {
    // Given
    const input: ProjectRevisionTransportInput = {
      ...transportInput(),
      timestamps: { createdAt, publishedAt: null, imageCreatedAt: {} },
    };

    // When
    const build = () => buildProjectRevisionTransport(input);

    // Then
    expect(build).toThrow();
  });

  it('builds the canonical deleted project identity', () => {
    // Given
    const aggregateId = 'deleted-project';

    // When
    const snapshot = buildDeletedProjectSnapshot(aggregateId);

    // Then
    expect(snapshot).toEqual({ aggregateType: 'project', aggregateId, deleted: true, project: null, images: [] });
    expect(projectSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});
