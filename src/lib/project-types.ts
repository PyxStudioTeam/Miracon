export const PROJECT_CATEGORIES = ['coastal', 'city', 'golden-visa'] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
export type ProjectStatus = 'draft' | 'published';
export type ProjectImageRole = 'card' | 'gallery';

export interface ImageVariantCandidate {
  src: string;
  width: number;
  height?: number;
}

export interface ImageVariantSet {
  width?: number;
  height?: number;
  avif?: ImageVariantCandidate[];
  webp?: ImageVariantCandidate[];
}

export interface ProjectImageVariantManifest {
  version: 1;
  images: Record<string, ImageVariantSet>;
}

export interface ProjectImage {
  id: string;
  url: string;
  storagePath?: string | null;
  alt: string;
  role: ProjectImageRole;
  sortOrder: number;
  width?: number | null;
  height?: number | null;
  focalX?: number;
  focalY?: number;
}

export interface ProjectCharacteristic {
  id: string;
  label: string;
  value: string;
  icon: 'bed' | 'bath' | 'area' | 'levels';
}

export interface ProjectBenefit {
  id: string;
  title: string;
  icon: string;
}

export interface FloorPlan {
  id: string;
  title: string;
  imageUrl: string;
  alt: string;
}

export interface FloorPlanGroup {
  id: string;
  title: string;
  plans: FloorPlan[];
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  address: string;
  cardAddress: string;
  price: string;
  shortDescription: string;
  fullDescription: string;
  introTitle: string;
  categories: ProjectCategory[];
  status: ProjectStatus;
  sortOrder: number;
  coverUrl: string;
  coverFocalX: number;
  coverFocalY: number;
  heroType: 'image' | 'video';
  heroVariant: 'standard' | 'immersive';
  heroSoundEnabled: boolean;
  heroIdleUi: boolean;
  heroUrl: string;
  heroMobileUrl?: string | null;
  heroPosterUrl: string | null;
  walkthroughVideoEnabled: boolean;
  walkthroughVideoTitle: string;
  walkthroughVideoDesktopUrl: string;
  walkthroughVideoMobileUrl: string | null;
  walkthroughVideoPosterUrl: string | null;
  heroFocalX: number;
  heroFocalY: number;
  introImageUrl: string;
  brochureUrl: string | null;
  mapQuery: string;
  mapUrl: string;
  cardImages: ProjectImage[];
  gallery: ProjectImage[];
  imageVariants?: ProjectImageVariantManifest;
  characteristics: ProjectCharacteristic[];
  benefits: ProjectBenefit[];
  floorPlanGroups: FloorPlanGroup[];
  nearbyPlaces: string[];
  seoTitle: string;
  seoDescription: string;
  updatedAt: string;
}

export type ProjectDraft = Omit<Project, 'id' | 'updatedAt'>;

export const categoryLabels: Record<ProjectCategory, string> = {
  coastal: 'Coastal',
  city: 'City',
  'golden-visa': 'Golden Visa',
};
