import { normalizeBrochurePath } from './brochure-paths';

export type SiteRuntime = 'development' | 'production' | 'test';

export type SiteRuntimeEnvironment = {
  readonly isProductionBuild: boolean;
  readonly mode: string;
  readonly nodeEnvironment: string | undefined;
};

export class SiteOriginConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteOriginConfigurationError';
  }
}

export function parseSiteOrigin(configuredUrl: string | undefined, runtime: SiteRuntime): URL {
  const value = configuredUrl?.trim();
  if (!value) {
    throw new SiteOriginConfigurationError('PUBLIC_SITE_URL is required');
  }

  let origin: URL;
  try {
    origin = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new SiteOriginConfigurationError('PUBLIC_SITE_URL must be an absolute HTTP(S) origin');
    }
    throw error;
  }

  const isHttp = origin.protocol === 'http:';
  const isHttps = origin.protocol === 'https:';
  const isLoopback = origin.hostname === 'localhost'
    || origin.hostname.endsWith('.localhost')
    || origin.hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/u.test(origin.hostname);
  const hasOnlyOrigin = origin.username === ''
    && origin.password === ''
    && origin.pathname === '/'
    && origin.search === ''
    && origin.hash === '';

  if ((!isHttp && !isHttps) || !hasOnlyOrigin) {
    throw new SiteOriginConfigurationError('PUBLIC_SITE_URL must be an HTTP(S) origin without a path, query, or fragment');
  }
  const isAllowedPreview = (process.env.ALLOW_PREVIEW_HOSTS === 'true' || process.env.RENDER === 'true')
    && (origin.hostname.endsWith('.onrender.com') || process.env.ALLOW_PREVIEW_HOSTS === 'true');

  if (runtime === 'production' && origin.origin !== 'https://miracon.gr' && !isAllowedPreview) {
    throw new SiteOriginConfigurationError('PUBLIC_SITE_URL must be exactly https://miracon.gr in production');
  }
  if (isHttp && !isLoopback) {
    throw new SiteOriginConfigurationError('HTTP PUBLIC_SITE_URL is allowed only for a development or test loopback origin');
  }

  return origin;
}

export function getSiteOrigin(requestUrl: URL): URL {
  const runtime = getSiteRuntime();
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!configuredUrl?.trim() && runtime !== 'production') {
    return parseSiteOrigin(requestUrl.origin, runtime);
  }
  return parseSiteOrigin(configuredUrl, runtime);
}

export function getPublicIdentityRedirect(requestUrl: URL, canonicalOrigin: URL): string | null {
  const brochurePath = normalizeBrochurePath(requestUrl.pathname);
  const redirectsLegacyBrochure = brochurePath !== requestUrl.pathname;
  const redirectsCanonicalHost = canonicalOrigin.hostname === 'miracon.gr'
    && requestUrl.hostname === 'www.miracon.gr';
  if (!redirectsLegacyBrochure && !redirectsCanonicalHost) return null;

  return redirectsCanonicalHost
    ? `${canonicalOrigin.origin}${brochurePath}${requestUrl.search}`
    : `${brochurePath}${requestUrl.search}`;
}

function getSiteRuntime(): SiteRuntime {
  return resolveSiteRuntime({
    isProductionBuild: import.meta.env.PROD,
    mode: import.meta.env.MODE,
    nodeEnvironment: process.env.NODE_ENV,
  });
}

export function resolveSiteRuntime(environment: SiteRuntimeEnvironment): SiteRuntime {
  if (environment.isProductionBuild) return 'production';
  if (environment.nodeEnvironment === 'test' || environment.mode === 'test') return 'test';
  return 'development';
}
