import type { APIRoute } from 'astro';
import { getPublishedProjects } from '../lib/projects';
import { absoluteLocalizedUrl, escapeXml } from '../lib/seo';

export const GET: APIRoute = async ({ url }) => {
  const projects = await getPublishedProjects();
  const routes: Array<{ path: string; lastmod?: string }> = [
    { path: '/' },
    { path: '/golden-visa' },
    ...projects.map((project) => ({
      path: `/projects/${encodeURIComponent(project.slug)}`,
      lastmod: Number.isNaN(Date.parse(project.updatedAt)) ? undefined : new Date(project.updatedAt).toISOString(),
    })),
  ];
  const entries = routes.flatMap(({ path, lastmod }) => {
    const en = absoluteLocalizedUrl(path, 'en', url);
    const el = absoluteLocalizedUrl(path, 'el', url);
    const alternates = { en, el, default: en };
    return [{ loc: en, lastmod, alternates }, { loc: el, lastmod, alternates }];
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map(({ loc, lastmod, alternates }) => [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(alternates.en)}" />`,
      `    <xhtml:link rel="alternate" hreflang="el" href="${escapeXml(alternates.el)}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(alternates.default)}" />`,
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
