import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'el'],
    fallback: { el: 'en' },
    routing: {
      prefixDefaultLocale: false,
      fallbackType: 'rewrite',
    },
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
