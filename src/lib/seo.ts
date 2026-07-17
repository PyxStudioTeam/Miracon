const normalizeOrigin = (value: string) => value.replace(/\/+$/, '');

export function getSiteOrigin(requestUrl: URL): string {
  const configuredUrl = import.meta.env.PUBLIC_SITE_URL?.trim();

  if (configuredUrl) {
    try {
      return normalizeOrigin(new URL(configuredUrl).origin);
    } catch {
      console.warn('PUBLIC_SITE_URL must be an absolute URL. Falling back to the current request origin.');
    }
  }

  return normalizeOrigin(requestUrl.origin);
}

export function absoluteSiteUrl(pathOrUrl: string, requestUrl: URL): string {
  try {
    return new URL(pathOrUrl, `${getSiteOrigin(requestUrl)}/`).href;
  } catch {
    return `${getSiteOrigin(requestUrl)}/`;
  }
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
