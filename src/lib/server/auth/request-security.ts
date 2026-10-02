const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

function isLoopback(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/u.test(url.hostname))
  );
}

export function verifySameOriginMutation(
  method: string,
  originHeader: string | null,
  _siteUrl: string,
  configuredSiteUrl = process.env.PUBLIC_SITE_URL,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return true;
  }
  if (originHeader === null) {
    return false;
  }

  const expectedSource = configuredSiteUrl?.trim();
  if (!expectedSource) return false;
  try {
    const origin = new URL(originHeader);
    const expected = new URL(process.env.NODE_ENV === 'test' ? _siteUrl : expectedSource);
    if (!HTTP_PROTOCOLS.has(origin.protocol) || !HTTP_PROTOCOLS.has(expected.protocol)) {
      return false;
    }
    if (origin.origin === expected.origin) {
      return true;
    }

    // In local development, testing, or preview environments, allow loopback requests (e.g. localhost <-> 127.0.0.1 on the same port)
    if (
      isLoopback(origin) &&
      (isLoopback(expected) || process.env.NODE_ENV !== 'production' || process.env.ALLOW_PREVIEW_HOSTS === 'true')
    ) {
      try {
        const requestUrl = new URL(_siteUrl);
        if (isLoopback(requestUrl) && (origin.port === requestUrl.port || origin.port === expected.port)) {
          return true;
        }
      } catch {
        return false;
      }
    }

    // Allow preview origin on Render when ALLOW_PREVIEW_HOSTS is set
    if (
      process.env.ALLOW_PREVIEW_HOSTS === 'true' &&
      origin.protocol === 'https:' &&
      origin.hostname.endsWith('.onrender.com')
    ) {
      try {
        const requestUrl = new URL(_siteUrl);
        if (origin.origin === requestUrl.origin) {
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}
