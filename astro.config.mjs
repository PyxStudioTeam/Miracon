import react from '@astrojs/react';
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // The built-in checkOrigin CSRF guard compares the Origin header to the
  // request URL as seen by the app. Behind a reverse proxy (Passenger) that
  // URL is internal (http://miracon.gr), so legitimate https origins are
  // rejected. Our own verifySameOriginMutation is stricter and uses the
  // canonical PUBLIC_SITE_URL, so Astro's redundant check is disabled.
  //
  // allowedDomains lets the Node adapter trust the proxy's X-Forwarded-* so
  // each visitor gets their own client address. Without it every request
  // behind Passenger shares one 127.0.0.1 bucket, and any failed login
  // attempt (including bots) locks the administrator out for 15 minutes.
  security: {
    checkOrigin: false,
    allowedDomains: [
      { hostname: 'miracon.gr' },
      { hostname: 'www.miracon.gr' },
    ],
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'el'],
    routing: 'manual',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
