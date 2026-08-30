import type { QueryResult, QueryResultRow } from 'pg';
import { mapProjectRow } from '../projects';
import type { Project } from '../project-types';

export interface ProjectDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface ProjectRow extends QueryResultRow {
  readonly project_images: Record<string, unknown>[];
}

export interface ProjectOrder {
  readonly id: string;
  readonly sortOrder: number;
}

const projectSelect = `
  select project.*, coalesce(
    jsonb_agg(to_jsonb(image) order by image.sort_order)
      filter (where image.id is not null),
    '[]'::jsonb
  ) as project_images
  from miracon.projects as project
  left join miracon.project_images as image on image.project_id = project.id
`;

export async function getPublishedProjects(database: ProjectDatabase): Promise<Project[]> {
  const result = await database.query<ProjectRow>(`${projectSelect}
    where project.status = 'published'
    group by project.id
    order by project.sort_order`);
  return result.rows.map(mapProjectRow);
}

export async function getPublishedProjectBySlug(
  database: ProjectDatabase,
  slug: string,
): Promise<Project | null> {
  const result = await database.query<ProjectRow>(`${projectSelect}
    where project.status = 'published' and project.slug = $1
    group by project.id`, [slug]);
  const project = result.rows[0];
  return project ? mapProjectRow(project) : null;
}

export async function getAdminProjects(database: ProjectDatabase): Promise<Project[]> {
  const result = await database.query<ProjectRow>(`${projectSelect}
    group by project.id
    order by project.sort_order`);
  return result.rows.map(mapProjectRow);
}

export async function getAdminProjectBySlug(
  database: ProjectDatabase,
  slug: string,
): Promise<Project | null> {
  const result = await database.query<ProjectRow>(`${projectSelect}
    where project.slug = $1
    group by project.id`, [slug]);
  const project = result.rows[0];
  return project ? mapProjectRow(project) : null;
}

export async function saveProject(database: ProjectDatabase, project: Omit<Project, 'updatedAt'>): Promise<Project> {
  await database.query(
    'select miracon.save_project_with_images($1::jsonb, $2::jsonb)',
    [JSON.stringify(projectToRow(project)), JSON.stringify(projectImagesToRows(project))],
  );
  const result = await database.query<ProjectRow>(`${projectSelect}
    where project.id = $1
    group by project.id`, [project.id]);
  const saved = result.rows[0];
  if (!saved) throw new Error('Saved project was not found');
  return mapProjectRow(saved);
}

export async function reorderProjects(
  database: ProjectDatabase,
  items: readonly ProjectOrder[],
): Promise<void> {
  await database.query('select miracon.reorder_projects($1::jsonb)', [
    JSON.stringify(items.map((item) => ({ id: item.id, sort_order: item.sortOrder }))),
  ]);
}

export async function deleteProject(database: ProjectDatabase, projectId: string): Promise<void> {
  await database.query('select miracon.delete_project($1)', [projectId]);
}

function projectToRow(project: Omit<Project, 'updatedAt'>) {
  return {
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
    seo_title: project.seoTitle || `${project.title} - MIRACON`,
    seo_description: project.seoDescription || project.shortDescription,
    translations: project.translations ?? {},
  };
}

function projectImagesToRows(project: Omit<Project, 'updatedAt'>) {
  return [...project.cardImages, ...project.gallery].map((image, index) => ({
    id: image.id,
    url: image.url,
    storage_path: image.storagePath ?? null,
    alt: image.alt,
    role: image.role,
    sort_order: image.sortOrder ?? index,
    width: image.width ?? null,
    height: image.height ?? null,
    focal_x: image.focalX ?? 50,
    focal_y: image.focalY ?? 50,
  }));
}
