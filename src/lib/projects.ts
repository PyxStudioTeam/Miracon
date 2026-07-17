import { seedProjects } from '../data/projects';
import type { Project, ProjectImage } from './project-types';
import { createPublicSupabaseClient } from './supabase';

type ProjectRow = Record<string, unknown> & {
  project_images?: Record<string, unknown>[];
};

function mapImage(row: Record<string, unknown>): ProjectImage {
  return {
    id: String(row.id),
    url: String(row.url),
    storagePath: row.storage_path ? String(row.storage_path) : null,
    alt: String(row.alt ?? ''),
    role: row.role === 'gallery' ? 'gallery' : 'card',
    sortOrder: Number(row.sort_order ?? 0),
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    focalX: Number(row.focal_x ?? 50),
    focalY: Number(row.focal_y ?? 50),
  };
}

export function mapProjectRow(row: ProjectRow): Project {
  const images = (row.project_images ?? []).map(mapImage).sort((a, b) => a.sortOrder - b.sortOrder);
  const isLegacyKriopigi = String(row.slug) === 'kriopigi-villas' && row.hero_variant === undefined;

  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    address: String(row.address ?? ''),
    price: String(row.price ?? ''),
    shortDescription: String(row.short_description ?? ''),
    fullDescription: String(row.full_description ?? ''),
    introTitle: String(row.intro_title ?? ''),
    categories: (row.categories ?? []) as Project['categories'],
    status: row.status === 'published' ? 'published' : 'draft',
    sortOrder: Number(row.sort_order ?? 0),
    coverUrl: String(row.cover_url ?? ''),
    coverFocalX: Number(row.cover_focal_x ?? 50),
    coverFocalY: Number(row.cover_focal_y ?? 50),
    heroType: row.hero_type === 'video' ? 'video' : 'image',
    heroVariant: row.hero_variant === 'immersive' || isLegacyKriopigi ? 'immersive' : 'standard',
    heroSoundEnabled: row.hero_sound_enabled === undefined ? isLegacyKriopigi : Boolean(row.hero_sound_enabled),
    heroIdleUi: row.hero_idle_ui === undefined ? isLegacyKriopigi : Boolean(row.hero_idle_ui),
    heroUrl: String(row.hero_url ?? '').replace(
      '/img/kriopigi-detail/hero-video-optimized.mp4',
      '/img/kriopigi-detail/hero-video-web.mp4',
    ),
    heroPosterUrl: row.hero_poster_url ? String(row.hero_poster_url) : null,
    heroFocalX: Number(row.hero_focal_x ?? 50),
    heroFocalY: Number(row.hero_focal_y ?? 50),
    introImageUrl: String(row.intro_image_url ?? ''),
    brochureUrl: row.brochure_url ? String(row.brochure_url) : null,
    mapQuery: String(row.map_query ?? ''),
    cardImages: images.filter((image) => image.role === 'card'),
    gallery: images.filter((image) => image.role === 'gallery'),
    characteristics: (row.characteristics ?? []) as Project['characteristics'],
    benefits: (row.benefits ?? []) as Project['benefits'],
    floorPlanGroups: (row.floor_plan_groups ?? []) as Project['floorPlanGroups'],
    nearbyPlaces: (row.nearby_places ?? []) as string[],
    seoTitle: String(row.seo_title ?? row.title),
    seoDescription: String(row.seo_description ?? row.short_description ?? ''),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function getPublishedProjects(): Promise<Project[]> {
  const supabase = createPublicSupabaseClient();

  if (!supabase) {
    return import.meta.env.DEV
      ? seedProjects.filter((project) => project.status === 'published').sort((a, b) => a.sortOrder - b.sortOrder)
      : [];
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*, project_images(*)')
    .eq('status', 'published')
    .order('sort_order');

  if (error) {
    console.error('Unable to load projects from Supabase:', error.message);
    return [];
  }

  if (!data?.length) {
    return [];
  }

  return (data as ProjectRow[]).map(mapProjectRow);
}

export async function getPublishedProjectBySlug(slug: string): Promise<Project | null> {
  const projects = await getPublishedProjects();
  return projects.find((project) => project.slug === slug) ?? null;
}
