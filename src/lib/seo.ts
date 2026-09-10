import { getSiteOrigin } from './site-origin';
import { localizePath, type SiteLocale } from './i18n';

export function absoluteSiteUrl(pathOrUrl: string, requestUrl: URL): string {
  try {
    return new URL(pathOrUrl, getSiteOrigin(requestUrl)).href;
  } catch {
    return getSiteOrigin(requestUrl).href;
  }
}

export function absoluteLocalizedUrl(path: string, locale: SiteLocale, requestUrl: URL): string {
  return absoluteSiteUrl(localizePath(path, locale), requestUrl);
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
