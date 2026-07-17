import type { APIRoute } from 'astro';
import { getPublishedProjects } from '../lib/projects';
import { absoluteSiteUrl, escapeXml } from '../lib/seo';

export const GET: APIRoute = async ({ url }) => {
  const projects = await getPublishedProjects();
  const entries: Array<{ loc: string; lastmod?: string }> = [
    { loc: absoluteSiteUrl('/', url) },
    { loc: absoluteSiteUrl('/golden-visa', url) },
    ...projects.map((project) => ({
      loc: absoluteSiteUrl(`/projects/${encodeURIComponent(project.slug)}`, url),
      lastmod: Number.isNaN(Date.parse(project.updatedAt)) ? undefined : new Date(project.updatedAt).toISOString(),
    })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(({ loc, lastmod }) => [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
      '  </url>',
    ].join('\n')),
    '</urlset>',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
