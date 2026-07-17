import { createPublicSupabaseClient } from './supabase';

export type HomeHeroVideo = {
  id: string;
  title: string;
  projectId: string | null;
  desktopUrl: string;
  desktopStoragePath: string | null;
  mobileUrl: string | null;
  mobileStoragePath: string | null;
  sortOrder: number;
  isActive: boolean;
};

export const fallbackHomeHeroVideos: HomeHeroVideo[] = [
  {
    id: 'default-home-hero',
    title: 'MIRACON introduction',
    projectId: null,
    desktopUrl: '/img/hero-bg-optimized.mp4',
    desktopStoragePath: null,
    mobileUrl: '/img/hero-bg-mobile.mp4',
    mobileStoragePath: null,
    sortOrder: 0,
    isActive: true,
  },
];

export function mapHomeHeroVideo(row: Record<string, unknown>): HomeHeroVideo {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    projectId: row.project_id ? String(row.project_id) : null,
    desktopUrl: String(row.desktop_url ?? ''),
    desktopStoragePath: row.desktop_storage_path ? String(row.desktop_storage_path) : null,
    mobileUrl: row.mobile_url ? String(row.mobile_url) : null,
    mobileStoragePath: row.mobile_storage_path ? String(row.mobile_storage_path) : null,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
  };
}

export async function getHomeHeroVideos(): Promise<HomeHeroVideo[]> {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return fallbackHomeHeroVideos;

  const { data, error } = await supabase
    .from('homepage_videos')
    .select('*')
    .eq('is_active', true)
    .neq('desktop_url', '')
    .order('sort_order');

  if (error || !data?.length) return fallbackHomeHeroVideos;
  return data.map((row) => mapHomeHeroVideo(row));
}
