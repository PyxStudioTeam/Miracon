const localAvifPatterns = [
  /^\/img\/figma_(?:artemis|giannitson|kriopigi|monastiriou|olympus)_(?:main|side_[12])\.png$/i,
  /^\/img\/figma-mobile\/(?:hero|golden-visa|kriopigi-villas|olympus-sea-view|artemis-residences|monastiriou-4-residences|giannitson-thessaloniki)\.png$/i,
  /^\/img\/(?:about_bg|figma_golden_visa|golden_visa_[234])\.png$/i,
  /^\/img\/golden-visa\/hero-(?:beach|interior)\.jpg$/i,
  /^\/img\/kriopigi-detail\/(?:hero|intro|gallery-(?:exterior|interior)-\d|крип6 1[12])\.png$/i,
  /^\/img\/kriopigi-detail\/[^/]+6 1[12]\.png$/i,
  /^\/img\/olympus-detail\/(?:hero|intro)\.png$/i,
];

export interface OptimizedImageSources {
  avif: string | null;
  webp: string | null;
  avifSrcset: string | null;
  webpSrcset: string | null;
  width?: number;
  height?: number;
}

const remoteImageSources: Record<string, OptimizedImageSources> = {
  'https://qqfowjefhelcmkbcrsff.supabase.co/storage/v1/object/public/project-media/artemis-residences/f32b4584-46e6-49fa-b342-dd42d6a2b5f0-chatgpt-image-9-.-2026-.-04-50-21-1-1-.png': {
    avif: '/img/remote-heroes/artemis-residences.avif',
    webp: '/img/remote-heroes/artemis-residences.webp',
    avifSrcset: null,
    webpSrcset: null,
  },
  'https://qqfowjefhelcmkbcrsff.supabase.co/storage/v1/object/public/project-media/monastiriou-4-residences/41cbec25-c67f-46da-a217-00206ecceb8e-chatgpt-image-9-.-2026-.-04-50-21-1-2-.png': {
    avif: '/img/remote-heroes/monastiriou-4-residences.avif',
    webp: '/img/remote-heroes/monastiriou-4-residences.webp',
    avifSrcset: null,
    webpSrcset: null,
  },
  'https://qqfowjefhelcmkbcrsff.supabase.co/storage/v1/object/public/project-media/giannitson-thessaloniki/67bf57f1-3641-40b0-8707-d4b1596f141b-chatgpt-image-jul-13-2026-04-50-57-am-1.png': {
    avif: '/img/remote-heroes/giannitson-thessaloniki.avif',
    webp: '/img/remote-heroes/giannitson-thessaloniki.webp',
    avifSrcset: null,
    webpSrcset: null,
  },
};

export function normalizeMediaUrl(source?: string | null) {
  return source?.match(/^([^?#]+)/)?.[1] ?? '';
}

export function getImageVariantSet(manifest: ProjectImageVariantManifest | undefined, source?: string | null): ImageVariantSet | null {
  if (!manifest || !source) return null;
  const normalized = normalizeMediaUrl(source);
  return manifest.images[normalized] ?? manifest.images[source] ?? null;
}

function variantSrcset(candidates: ImageVariantSet['avif'] | ImageVariantSet['webp']) {
  if (!candidates?.length) return null;
  return candidates.map((candidate) => `${candidate.src} ${candidate.width}w`).join(', ');
}

export function getOptimizedImageSources(source?: string | null, variants?: ImageVariantSet | null): OptimizedImageSources {
  if (!source) return { avif: null, webp: null, avifSrcset: null, webpSrcset: null };

  const avifCandidates = variants?.avif?.filter((candidate) => candidate.src && candidate.width > 0).sort((a, b) => a.width - b.width);
  const webpCandidates = variants?.webp?.filter((candidate) => candidate.src && candidate.width > 0).sort((a, b) => a.width - b.width);
  if (avifCandidates?.length || webpCandidates?.length) {
    return {
      avif: avifCandidates?.at(-1)?.src ?? null,
      webp: webpCandidates?.at(-1)?.src ?? null,
      avifSrcset: variantSrcset(avifCandidates),
      webpSrcset: variantSrcset(webpCandidates),
      ...(variants?.width ? { width: variants.width } : {}),
      ...(variants?.height ? { height: variants.height } : {}),
    };
  }

  const match = source.match(/^([^?#]+)(.*)$/);
  if (!match) return { avif: null, webp: null, avifSrcset: null, webpSrcset: null };

  const [, path, suffix] = match;
  const remoteSources = remoteImageSources[path.toLowerCase()];
  if (remoteSources) return remoteSources;

  const avif = localAvifPatterns.some((pattern) => pattern.test(path))
    ? `${path.replace(/\.(?:png|jpe?g)$/i, '.avif')}${suffix}`
    : null;
  return { avif, webp: null, avifSrcset: null, webpSrcset: null };
}

export function getLocalAvifSource(source?: string | null): string | null {
  return getOptimizedImageSources(source).avif;
}
import type { ImageVariantSet, ProjectImageVariantManifest } from './project-types';
