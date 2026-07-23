import { defineMiddleware } from 'astro:middleware';

const developmentConnections = import.meta.env.DEV
  ? ' ws://127.0.0.1:* ws://localhost:*'
  : '';

export const onRequest = defineMiddleware(async ({ url }, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  const frameAncestors = url.pathname.startsWith('/preview/') ? "'self'" : "'none'";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self' https://api.web3forms.com",
    "script-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://hcaptcha.com https://*.hcaptcha.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://*.supabase.co https://hcaptcha.com https://*.hcaptcha.com",
    "media-src 'self' blob: https://*.supabase.co",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.web3forms.com https://hcaptcha.com https://*.hcaptcha.com${developmentConnections}`,
    "frame-src 'self' https://www.google.com https://hcaptcha.com https://*.hcaptcha.com",
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
