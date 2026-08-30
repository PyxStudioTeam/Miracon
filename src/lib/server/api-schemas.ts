import { z } from 'zod';
import { isValidTermsPdfUrl } from '../site-settings-shared';

const nullableUrl = z.string().max(2_048).nullable();
const optionalNullableUrl = nullableUrl.optional();

const projectImageSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().min(1).max(2_048),
  storagePath: z.string().max(2_048).nullable().optional(),
  alt: z.string().max(1_024),
  role: z.enum(['card', 'gallery']),
  sortOrder: z.number().int().min(0),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
});

const projectVideoSchema = z.object({
  id: z.string().min(1).max(128),
  desktopUrl: z.string().min(1).max(2_048),
  mobileUrl: nullableUrl,
  posterUrl: nullableUrl,
});

const translationSchema = z.object({
  title: z.string().max(1_024).optional(),
  address: z.string().max(1_024).optional(),
  cardAddress: z.string().max(1_024).optional(),
  price: z.string().max(1_024).optional(),
  shortDescription: z.string().max(10_000).optional(),
  fullDescription: z.string().max(100_000).optional(),
  introTitle: z.string().max(1_024).optional(),
  walkthroughVideoTitle: z.string().max(1_024).optional(),
  nearbyPlaces: z.array(z.string().max(1_024)).optional(),
  seoTitle: z.string().max(1_024).optional(),
  seoDescription: z.string().max(10_000).optional(),
  characteristics: z.record(z.string(), z.object({ label: z.string().max(1_024).optional(), value: z.string().max(1_024).optional() })).optional(),
  benefits: z.record(z.string(), z.object({ title: z.string().max(1_024).optional() })).optional(),
  floorPlanGroups: z.record(z.string(), z.object({
    title: z.string().max(1_024).optional(),
    plans: z.record(z.string(), z.object({ title: z.string().max(1_024).optional(), alt: z.string().max(1_024).optional() })).optional(),
  })).optional(),
  imageAlts: z.record(z.string(), z.string().max(1_024)).optional(),
});

const imageVariantSchema = z.object({
  src: z.string().min(1).max(2_048),
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
});

const imageVariantSetSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  avif: z.array(imageVariantSchema).optional(),
  webp: z.array(imageVariantSchema).optional(),
});

export const projectSchema = z.object({
  id: z.string().min(1).max(128),
  slug: z.string().min(1).max(256),
  title: z.string().max(1_024),
  address: z.string().max(1_024),
  cardAddress: z.string().max(1_024),
  price: z.string().max(1_024),
  remainingUnits: z.number().int().min(0).nullable(),
  shortDescription: z.string().max(10_000),
  fullDescription: z.string().max(100_000),
  introTitle: z.string().max(1_024),
  categories: z.array(z.enum(['coastal', 'city', 'golden-visa'])).max(3),
  status: z.enum(['draft', 'published']),
  sortOrder: z.number().int().min(0),
  coverUrl: z.string().max(2_048),
  coverFocalX: z.number().min(0).max(100),
  coverFocalY: z.number().min(0).max(100),
  heroType: z.enum(['image', 'video']),
  heroVariant: z.enum(['standard', 'immersive']),
  heroSoundEnabled: z.boolean(),
  heroIdleUi: z.boolean(),
  heroUrl: z.string().max(2_048),
  heroMobileUrl: optionalNullableUrl,
  heroPosterUrl: nullableUrl,
  heroVideos: z.array(projectVideoSchema),
  walkthroughVideoEnabled: z.boolean(),
  walkthroughVideoTitle: z.string().max(1_024),
  walkthroughVideoDesktopUrl: z.string().max(2_048),
  walkthroughVideoMobileUrl: nullableUrl,
  walkthroughVideoPosterUrl: nullableUrl,
  walkthroughVideos: z.array(projectVideoSchema),
  heroFocalX: z.number().min(0).max(100),
  heroFocalY: z.number().min(0).max(100),
  introImageUrl: z.string().max(2_048),
  brochureUrl: nullableUrl,
  mapQuery: z.string().max(2_048),
  mapUrl: z.string().max(2_048),
  cardImages: z.array(projectImageSchema),
  gallery: z.array(projectImageSchema),
  imageVariants: z.object({ version: z.literal(1), images: z.record(z.string(), imageVariantSetSchema) }).optional(),
  characteristics: z.array(z.object({ id: z.string().min(1).max(128), label: z.string().max(1_024), value: z.string().max(1_024), icon: z.enum(['bed', 'bath', 'area', 'levels']) })),
  benefits: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().max(1_024), icon: z.string().max(128) })),
  floorPlanGroups: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().max(1_024), plans: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().max(1_024), imageUrl: z.string().max(2_048), alt: z.string().max(1_024) })) })),
  nearbyPlaces: z.array(z.string().max(1_024)),
  seoTitle: z.string().max(1_024),
  seoDescription: z.string().max(10_000),
  translations: z.record(z.string(), translationSchema).optional(),
  updatedAt: z.iso.datetime().optional(),
});

export const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(128), sortOrder: z.number().int().min(0) })).min(1),
});

const homepageVideoSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(1_024),
  projectId: z.string().min(1).max(128).nullable(),
  desktopUrl: z.string().min(1).max(2_048),
  desktopStoragePath: nullableUrl,
  mobileUrl: nullableUrl,
  mobileStoragePath: nullableUrl,
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export const homepageVideosSchema = z.object({ videos: z.array(homepageVideoSchema) });

const siteDocumentUrl = z.string().max(2_048).refine((value) => value === '' || isValidTermsPdfUrl(value));

export const siteSettingsSchema = z.object({
  footerTermsVisible: z.boolean(),
  footerTermsPdfUrl: siteDocumentUrl,
  footerPrivacyVisible: z.boolean(),
  footerPrivacyPdfUrl: siteDocumentUrl,
  footerCookieVisible: z.boolean(),
  footerCookiePdfUrl: siteDocumentUrl,
});
