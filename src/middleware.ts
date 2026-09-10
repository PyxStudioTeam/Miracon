import { defineMiddleware } from 'astro:middleware';
import { getPublicIdentityRedirect, getSiteOrigin } from './lib/site-origin';

const developmentConnections = import.meta.env.DEV
  ? ' ws://127.0.0.1:* ws://localhost:*'
  : '';

export const onRequest = defineMiddleware(async ({ url }, next) => {
  const redirect = getPublicIdentityRedirect(url, getSiteOrigin(url));
  if (redirect) return new Response(null, { status: 308, headers: { Location: redirect } });

  const target = url.pathname === '/el' || url.pathname.startsWith('/el/')
    ? `${url.pathname.slice(3) || '/'}${url.search}`
    : undefined;
  const response = await (target ? next(target) : next());
  const headers = new Headers(response.headers);
  const isPreview = url.pathname.startsWith('/preview/') || url.pathname.startsWith('/el/preview/');
  const frameAncestors = isPreview ? "'self'" : "'none'";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self'${developmentConnections}`,
    "frame-src 'self' https://www.google.com",
    "worker-src 'self' blob:",
    ...(import.meta.env.PROD ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  headers.set('Content-Security-Policy', contentSecurityPolicy);
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', frameAncestors === "'self'" ? 'SAMEORIGIN' : 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
