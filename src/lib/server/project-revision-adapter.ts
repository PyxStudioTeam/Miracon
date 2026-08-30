import { z } from 'zod';
import type { Project } from '../project-types';
import {
  projectSnapshotSchema,
  type CreateProposalInput,
  type ProjectSnapshot,
} from './revision-contracts';

export type ProjectRevisionTimestamps = {
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly imageCreatedAt: Readonly<Record<string, string>>;
};

export type ProjectRevisionTransportInput = {
  readonly project: Project;
  readonly timestamps: ProjectRevisionTimestamps;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: readonly string[];
};

export type ProjectRevisionTransport = {
  readonly aggregateType: 'project';
  readonly aggregateId: string;
  readonly snapshot: ProjectSnapshot;
  readonly expectedRevisionId: CreateProposalInput['expectedRevisionId'];
  readonly mediaFileIds: CreateProposalInput['mediaFileIds'];
};

const imageRoleOrder = { card: 0, gallery: 1 } as const;
const canonicalTimestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());

export function buildProjectRevisionTransport(input: ProjectRevisionTransportInput): ProjectRevisionTransport {
  const { project, timestamps } = input;
  const images = [...project.cardImages, ...project.gallery]
    .map((image) => ({
      id: image.id,
      project_id: project.id,
      url: image.url,
      storage_path: image.storagePath ?? null,
      alt: image.alt,
      role: image.role,
      sort_order: image.sortOrder,
      width: image.width ?? null,
      height: image.height ?? null,
      focal_x: image.focalX ?? 50,
      focal_y: image.focalY ?? 50,
      created_at: canonicalTimestampSchema.parse(timestamps.imageCreatedAt[image.id]),
    }))
    .sort((left, right) => imageRoleOrder[left.role] - imageRoleOrder[right.role]
      || left.sort_order - right.sort_order
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const snapshot = projectSnapshotSchema.parse({
    aggregateType: 'project',
    aggregateId: project.id,
    deleted: false,
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      address: project.address,
      card_address: project.cardAddress,
      price: project.price,
      remaining_units: project.remainingUnits,
      short_description: project.shortDescription,
      full_description: project.fullDescription,
      intro_title: project.introTitle,
      categories: project.categories,
      status: project.status,
      sort_order: project.sortOrder,
      cover_url: project.coverUrl,
      cover_focal_x: project.coverFocalX,
      cover_focal_y: project.coverFocalY,
      image_variants: project.imageVariants ?? { version: 1, images: {} },
      hero_type: project.heroType,
      hero_variant: project.heroVariant,
      hero_sound_enabled: project.heroSoundEnabled,
      hero_idle_ui: project.heroIdleUi,
      hero_url: project.heroUrl,
      hero_mobile_url: project.heroMobileUrl ?? null,
      hero_poster_url: project.heroPosterUrl,
      hero_videos: project.heroVideos,
      walkthrough_video_enabled: project.walkthroughVideoEnabled,
      walkthrough_video_title: project.walkthroughVideoTitle,
      walkthrough_video_desktop_url: project.walkthroughVideoDesktopUrl,
      walkthrough_video_mobile_url: project.walkthroughVideoMobileUrl,
      walkthrough_video_poster_url: project.walkthroughVideoPosterUrl,
      walkthrough_videos: project.walkthroughVideos,
      hero_focal_x: project.heroFocalX,
      hero_focal_y: project.heroFocalY,
      intro_image_url: project.introImageUrl,
      brochure_url: project.brochureUrl,
      map_query: project.mapQuery,
      map_url: project.mapUrl,
      characteristics: project.characteristics,
      benefits: project.benefits,
      floor_plan_groups: project.floorPlanGroups,
      nearby_places: project.nearbyPlaces,
      translations: project.translations ?? {},
      seo_title: project.seoTitle || `${project.title} - MIRACON`,
      seo_description: project.seoDescription || project.shortDescription,
      published_at: timestamps.publishedAt === null ? null : canonicalTimestampSchema.parse(timestamps.publishedAt),
      created_at: canonicalTimestampSchema.parse(timestamps.createdAt),
      updated_at: canonicalTimestampSchema.parse(project.updatedAt),
    },
    images,
  });

  return {
    aggregateType: 'project',
    aggregateId: project.id,
    snapshot,
    expectedRevisionId: input.expectedRevisionId,
    mediaFileIds: [...new Set(input.mediaFileIds)].sort(),
  };
}

export function buildDeletedProjectSnapshot(aggregateId: string): ProjectSnapshot {
  return projectSnapshotSchema.parse({
    aggregateType: 'project',
    aggregateId,
    deleted: true,
    project: null,
    images: [],
  });
}
