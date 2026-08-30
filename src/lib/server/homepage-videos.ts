import type { QueryResult, QueryResultRow } from 'pg';
import { mapHomeHeroVideo } from '../home-hero.ts';
import type { HomeHeroVideo } from '../home-hero.ts';

export interface HomepageVideoDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export type HomepageVideosWithHead = {
  readonly videos: HomeHeroVideo[];
  readonly currentRevisionId: string | null;
};

export async function getActiveHomepageVideos(
  database: HomepageVideoDatabase,
): Promise<HomeHeroVideo[]> {
  const result = await database.query(
    `select * from miracon.homepage_videos
     where is_active and desktop_url <> ''
     order by sort_order`,
  );
  return result.rows.map(mapHomeHeroVideo);
}

export async function getHomepageVideos(database: HomepageVideoDatabase): Promise<HomeHeroVideo[]> {
  const result = await database.query(
    'select * from miracon.homepage_videos order by sort_order',
  );
  return result.rows.map(mapHomeHeroVideo);
}

export async function getHomepageVideosWithHead(
  database: HomepageVideoDatabase,
): Promise<HomepageVideosWithHead> {
  const result = await database.query(`
    select
      head.current_revision_id,
      coalesce(
        (
          select jsonb_agg(to_jsonb(video) order by video.sort_order)
          from miracon.homepage_videos as video
        ),
        '[]'::jsonb
      ) as videos
    from (
      select 'homepage_hero'::miracon.content_aggregate_type as aggregate_type, 'singleton' as aggregate_id
    ) as target
    left join miracon.content_revision_heads as head
      on head.aggregate_type = target.aggregate_type and head.aggregate_id = target.aggregate_id
  `);
  const row = result.rows[0];
  if (!row) return { videos: [], currentRevisionId: null };
  const rawVideos = (row['videos'] as Record<string, unknown>[]) ?? [];
  return {
    videos: rawVideos.map(mapHomeHeroVideo),
    currentRevisionId: row['current_revision_id'] ? String(row['current_revision_id']) : null,
  };
}

export async function replaceHomepageVideos(
  database: HomepageVideoDatabase,
  videos: readonly HomeHeroVideo[],
): Promise<void> {
  await database.query('select miracon.replace_homepage_videos($1::jsonb)', [
    JSON.stringify(videos.map((video) => ({
      id: video.id,
      title: video.title,
      project_id: video.projectId,
      desktop_url: video.desktopUrl,
      desktop_storage_path: video.desktopStoragePath,
      mobile_url: video.mobileUrl,
      mobile_storage_path: video.mobileStoragePath,
      sort_order: video.sortOrder,
      is_active: video.isActive,
    }))),
  ]);
}
