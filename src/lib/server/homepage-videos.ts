import type { QueryResult, QueryResultRow } from 'pg';
import { mapHomeHeroVideo } from '../home-hero';
import type { HomeHeroVideo } from '../home-hero';

export interface HomepageVideoDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

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
