import type { APIRoute } from 'astro';
import { absoluteSiteUrl } from '../lib/seo';

export const GET: APIRoute = ({ url }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /preview/',
    'Disallow: /api/',
    `Sitemap: ${absoluteSiteUrl('/sitemap.xml', url)}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
