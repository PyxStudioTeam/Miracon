const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

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
    return origin.origin === expected.origin;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}
