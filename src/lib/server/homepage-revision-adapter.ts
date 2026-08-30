import { z } from 'zod';
import type { HomeHeroVideo } from '../home-hero';
import {
  homepageHeroSnapshotSchema,
  SINGLETON_AGGREGATE_ID,
  type HomepageHeroSnapshot,
} from './revision-contracts';

export type HomepageHeroRevisionTransportInput = {
  readonly videos: readonly HomeHeroVideo[];
  readonly previousSnapshot: HomepageHeroSnapshot | null;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: readonly string[];
  readonly mutationTime: string;
};

export type HomepageHeroRevisionTransport = {
  readonly aggregateType: 'homepage_hero';
  readonly aggregateId: typeof SINGLETON_AGGREGATE_ID;
  readonly snapshot: HomepageHeroSnapshot;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: string[];
};

const canonicalTimestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());

export function buildHomepageHeroRevisionTransport(
  input: HomepageHeroRevisionTransportInput,
): HomepageHeroRevisionTransport {
  const mutationTime = canonicalTimestampSchema.parse(input.mutationTime);
  const previousVideos = new Map(
    input.previousSnapshot?.videos.map((video) => [video.id, video.created_at]) ?? [],
  );

  const videos = input.videos
    .map((video) => ({
      id: video.id,
      title: video.title,
      project_id: video.projectId ?? null,
      desktop_url: video.desktopUrl,
      desktop_storage_path: video.desktopStoragePath ?? null,
      mobile_url: video.mobileUrl ?? null,
      mobile_storage_path: video.mobileStoragePath ?? null,
      sort_order: video.sortOrder,
      is_active: video.isActive,
      created_at: canonicalTimestampSchema.parse(previousVideos.get(video.id) ?? mutationTime),
      updated_at: mutationTime,
    }))
    .sort((left, right) => left.sort_order - right.sort_order
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const snapshot = homepageHeroSnapshotSchema.parse({
    aggregateType: 'homepage_hero',
    aggregateId: SINGLETON_AGGREGATE_ID,
    videos,
  });

  return {
    aggregateType: 'homepage_hero',
    aggregateId: SINGLETON_AGGREGATE_ID,
    snapshot,
    expectedRevisionId: input.expectedRevisionId,
    mediaFileIds: [...new Set(input.mediaFileIds)].sort(),
  };
}
