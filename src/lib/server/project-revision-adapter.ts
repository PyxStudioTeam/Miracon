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

export function extractProjectMediaReferences(project: Project | Record<string, any> | null | undefined): string[] {
  if (!project || typeof project !== 'object') return [];
  const references = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        references.add(trimmed);
      }
    }
  };

  // 1. coverUrl / cover_url
  add(project.coverUrl ?? (project as any).cover_url);

  // 2. heroUrl / hero_url
  add(project.heroUrl ?? (project as any).hero_url);

  // 3. heroMobileUrl / hero_mobile_url
  add(project.heroMobileUrl ?? (project as any).hero_mobile_url);

  // 4. heroPosterUrl / hero_poster_url
  add(project.heroPosterUrl ?? (project as any).hero_poster_url);

  // 5. heroVideos / hero_videos (desktopUrl, mobileUrl, posterUrl)
  const heroVideos = project.heroVideos ?? (project as any).hero_videos;
  if (Array.isArray(heroVideos)) {
    for (const video of heroVideos) {
      if (video && typeof video === 'object') {
        add(video.desktopUrl ?? video.desktop_url);
        add(video.mobileUrl ?? video.mobile_url);
        add(video.posterUrl ?? video.poster_url);
      }
    }
  }

  // 6. walkthroughVideoDesktopUrl / walkthrough_video_desktop_url
  add(project.walkthroughVideoDesktopUrl ?? (project as any).walkthrough_video_desktop_url);

  // 7. walkthroughVideoMobileUrl / walkthrough_video_mobile_url
  add(project.walkthroughVideoMobileUrl ?? (project as any).walkthrough_video_mobile_url);

  // 8. walkthroughVideoPosterUrl / walkthrough_video_poster_url
  add(project.walkthroughVideoPosterUrl ?? (project as any).walkthrough_video_poster_url);

  // 9. walkthroughVideos / walkthrough_videos (desktopUrl, mobileUrl, posterUrl)
  const walkthroughVideos = project.walkthroughVideos ?? (project as any).walkthrough_videos;
  if (Array.isArray(walkthroughVideos)) {
    for (const video of walkthroughVideos) {
      if (video && typeof video === 'object') {
        add(video.desktopUrl ?? video.desktop_url);
        add(video.mobileUrl ?? video.mobile_url);
        add(video.posterUrl ?? video.poster_url);
      }
    }
  }

  // 10. introImageUrl / intro_image_url
  add(project.introImageUrl ?? (project as any).intro_image_url);

  // 11. brochureUrl / brochure_url
  add(project.brochureUrl ?? (project as any).brochure_url);

  // 12. cardImages / card_images (url, storagePath / storage_path)
  const cardImages = project.cardImages ?? (project as any).card_images;
  if (Array.isArray(cardImages)) {
    for (const image of cardImages) {
      if (image && typeof image === 'object') {
        add(image.url);
        add(image.storagePath ?? image.storage_path);
      }
    }
  }

  // 13. gallery (url, storagePath / storage_path)
  if (Array.isArray(project.gallery)) {
    for (const image of project.gallery) {
      if (image && typeof image === 'object') {
        add(image.url);
        add(image.storagePath ?? image.storage_path);
      }
    }
  }

  // Raw snapshot images array
  const images = (project as any).images;
  if (Array.isArray(images)) {
    for (const image of images) {
      if (image && typeof image === 'object') {
        add(image.url);
        add(image.storagePath ?? image.storage_path);
      }
    }
  }

  // 14. imageVariants / image_variants (candidate src urls & variant keys)
  const imageVariants = project.imageVariants ?? (project as any).image_variants;
  if (imageVariants?.images && typeof imageVariants.images === 'object') {
    for (const [key, variantSet] of Object.entries(imageVariants.images as Record<string, any>)) {
      add(key);
      if (variantSet && typeof variantSet === 'object') {
        if (Array.isArray(variantSet.avif)) {
          for (const candidate of variantSet.avif) {
            add(candidate?.src);
          }
        }
        if (Array.isArray(variantSet.webp)) {
          for (const candidate of variantSet.webp) {
            add(candidate?.src);
          }
        }
      }
    }
  }

  // 15. benefits (icon)
  if (Array.isArray(project.benefits)) {
    for (const benefit of project.benefits) {
      if (benefit && typeof benefit === 'object') {
        add(benefit.icon);
      }
    }
  }

  // 16. floorPlanGroups / floor_plan_groups (plans -> imageUrl / image_url)
  const floorPlanGroups = project.floorPlanGroups ?? (project as any).floor_plan_groups;
  if (Array.isArray(floorPlanGroups)) {
    for (const group of floorPlanGroups) {
      if (group && typeof group === 'object') {
        const plans = group.plans;
        if (Array.isArray(plans)) {
          for (const plan of plans) {
            if (plan && typeof plan === 'object') {
              add(plan.imageUrl ?? plan.image_url);
            }
          }
        }
      }
    }
  }

  return [...references];
}

export const extractProjectMediaUrls = extractProjectMediaReferences;

