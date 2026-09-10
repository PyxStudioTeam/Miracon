import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';
import { migrate } from '../scripts/postgres-migrate.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneEntry = fileURLToPath(new URL('../dist/server/entry.mjs', import.meta.url));
const chromeByRoute = {
  homeEn: { links: [['/#projects', 'Projects'], ['/golden-visa', 'Golden Visa'], ['/#about', 'About us'], ['/#contacts', 'Contacts']], languageHref: '/el/', language: 'Ελληνικά', languageCode: 'EN' },
  homeEl: { links: [['/el/#projects', 'Έργα'], ['/el/golden-visa', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/#contacts', 'Επικοινωνία']], languageHref: '/', language: 'English', languageCode: 'EL' },
  goldenVisaEl: { links: [['/el/#projects', 'Έργα'], ['/el/golden-visa#top', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/golden-visa#contacts', 'Επικοινωνία']], languageHref: '/golden-visa/', language: 'English', languageCode: 'EL' },
  projectEl: { links: [['/el/?filter=coastal#projects', 'Έργα'], ['/el/golden-visa', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/projects/standalone-build-project/#contacts', 'Επικοινωνία']], languageHref: '/projects/standalone-build-project/?campaign=greek', language: 'English', languageCode: 'EL' },
};

test('rejects Google document-wide translation suppression', () => {
  assert.throws(
    () => assertTranslationBoundaries(`${protectedHomeHtml}<meta name="google" content="notranslate">`, true),
    /Google translation suppression/u,
  );
});

test('rejects a protected header decoy beside an unprotected navigation header', () => {
  assert.throws(
    () => assertTranslationBoundaries(`${protectedHomeHtml}<header class="header"><nav class="nav-menu"></nav><nav class="mobile-nav"></nav></header>`, true),
    /sole navigation-bearing header/u,
  );
});

test('rejects translation suppression on ordinary homepage editorial content', () => {
  assert.throws(
    () => assertTranslationBoundaries(protectedHomeHtml.replace('class="about-section"', 'class="about-section notranslate" translate="no"'), true, 'about-section'),
    /about-section/u,
  );
});

const protectedHomeHtml = '<html><head></head><body><header class="header notranslate" translate="no"><nav class="nav-menu"></nav><nav class="mobile-nav"></nav></header><main><section class="about-section"></section><div class="hero-content notranslate" translate="no"></div><div class="filter-tabs notranslate" translate="no"></div></main></body></html>';

test('serves the built standalone application on the supplied port', { timeout: 180_000 }, async () => {
  // Given
  await requireBuiltStandaloneEntry();
  const databaseUrl = requireSafeDatabaseTestUrl();
  const mediaRoot = await mkdtemp(join(tmpdir(), 'miracon-standalone-media-'));
  let database;
  let server;

  try {
    database = await openClient(databaseUrl, 'miracon-standalone-build-test');
    await resetSchemas(database, databaseUrl);
    await migrate(databaseUrl);
    await database.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [
      JSON.stringify({
        id: 'standalone-build-project',
        slug: 'standalone-build-project',
        title: 'Standalone build project',
        status: 'published',
        sort_order: 0,
        translations: { el: { title: 'Αυτόνομο έργο δοκιμής' } },
      }),
      '[]',
    ]);
    await database.query('update miracon.homepage_videos set is_active = false');

    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // When
    server = startStandalone({ baseUrl, databaseUrl, mediaRoot, port });
    await waitForHealth(baseUrl, server);

    // Then
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, database: true, media: true });

    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Standalone build project/u);
    assert.match(homeHtml, /\/img\/hero-bg-web-30\.mp4/u);
    assert.match(homeHtml, /<link rel="canonical" href="https:\/\/miracon\.gr\/">/u);
    assert.match(homeHtml, /<meta property="og:url" content="https:\/\/miracon\.gr\/">/u);
    assert.match(homeHtml, /"url":"https:\/\/miracon\.gr\/"/u);
    assertLocalizedChrome(homeHtml, chromeByRoute.homeEn);
    assertTranslationBoundaries(homeHtml, true, 'about-section');

    const runtimeOriginLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://miracon.gr' },
      body: JSON.stringify({ email: 'missing@miracon.test', password: 'not-a-real-password' }),
    });
    assert.equal(runtimeOriginLogin.status, 401);
    assert.deepEqual(await runtimeOriginLogin.json(), {
      error: { code: 'invalid_credentials', message: 'Invalid email or password' },
    });

    const wwwRedirect = await new Promise((resolve, reject) => {
      const request = httpRequest(`${baseUrl}/el/api/health?probe=host`, {
        headers: { host: 'www.miracon.gr', 'x-forwarded-host': 'www.miracon.gr', 'x-forwarded-proto': 'https' },
      }, resolve);
      request.on('error', reject);
      request.end();
    });
    wwwRedirect.resume();
    assert.equal(wwwRedirect.statusCode, 308);
    assert.equal(wwwRedirect.headers.location, 'https://miracon.gr/el/api/health?probe=host');

    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Sitemap: https:\/\/miracon\.gr\/sitemap\.xml/u);

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    const sitemapXml = await sitemap.text();
    assert.match(sitemapXml, /<loc>https:\/\/miracon\.gr\/<\/loc>/u);
    assert.doesNotMatch(sitemapXml, /(?:<loc>|href=")(?:http:\/\/|https:\/\/(?:127\.0\.0\.1|www\.miracon\.gr))/u);

    for (const [legacyPath, targetPath] of [
      ['/brochures/A4%20Artemis_compressed.pdf', '/brochures/a4-artemis-compressed.pdf'],
      ['/brochures/Kriopigi%20Villas_compressed.pdf', '/brochures/kriopigi-villas-compressed.pdf'],
    ]) {
      const legacy = await fetch(`${baseUrl}${legacyPath}?download=1`, { redirect: 'manual' });
      assert.equal(legacy.status, 308);
      assert.equal(legacy.headers.get('location'), `${targetPath}?download=1`);
      const brochure = await fetch(`${baseUrl}${targetPath}`);
      assert.equal(brochure.status, 200);
      assert.match(brochure.headers.get('content-type') ?? '', /^application\/pdf\b/u);
    }

    const greekHome = await fetch(`${baseUrl}/el/`);
    assert.equal(greekHome.status, 200);
    const greekHomeHtml = await greekHome.text();
    assert.match(greekHomeHtml, /<html lang="el">/u);
    assert.match(greekHomeHtml, /Έργα/u);
    assert.match(greekHomeHtml, /<a\b[^>]*\bhref="\/"[^>]*\bhreflang="en"/u);
    assertLocalizedChrome(greekHomeHtml, chromeByRoute.homeEl);
    assertTranslationBoundaries(greekHomeHtml, true, 'about-section');

    const greekRoot = await fetch(`${baseUrl}/el?campaign=greek`);
    assert.equal(greekRoot.status, 200);
    const greekRootHtml = await greekRoot.text();
    assert.match(greekRootHtml, /<html lang="el">/u);
    assert.match(greekRootHtml, /<a\b[^>]*\bhref="\/\?campaign=greek"[^>]*\bhreflang="en"/u);

    const greekProject = await fetch(`${baseUrl}/el/projects/standalone-build-project?campaign=greek`);
    assert.equal(greekProject.status, 200);
    const greekProjectHtml = await greekProject.text();
    assert.ok(greekProjectHtml.includes('<html lang="el"'));
    assert.match(greekProjectHtml, /Αυτόνομο έργο δοκιμής/u);
    assert.match(greekProjectHtml, /<a\b[^>]*\bhref="\/projects\/standalone-build-project\/?\?campaign=greek"[^>]*\bhreflang="en"/u);
    assertLocalizedChrome(greekProjectHtml, chromeByRoute.projectEl);
    assertTranslationBoundaries(greekProjectHtml, false, 'project-intro-copy');

    const greekGoldenVisa = await fetch(`${baseUrl}/el/golden-visa`);
    assert.equal(greekGoldenVisa.status, 200);
    const greekGoldenVisaHtml = await greekGoldenVisa.text();
    assertLocalizedChrome(greekGoldenVisaHtml, chromeByRoute.goldenVisaEl);
    assertTranslationBoundaries(greekGoldenVisaHtml, false, 'gv-family');

    const asset = await fetch(`${baseUrl}/style.css`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /^text\/css\b/u);
  } finally {
    try {
      await stopStandalone(server);
    } finally {
      try {
        await database?.end();
      } finally {
        await rm(mediaRoot, { recursive: true, force: true });
      }
    }
  }
});

function assertLocalizedChrome(html, expected) {
  assert.doesNotMatch(html, /<html\b[^>]*\btranslate="no"/u);
  assert.doesNotMatch(html, /<body\b[^>]*\btranslate="no"/u);
  for (const [href, label] of expected.links) {
    assert.match(html, new RegExp(`<a\\b(?=[^>]*\\bhref="${escapeRegExp(href)}")[^>]*>\\s*${escapeRegExp(label)}\\s*<`, 'u'));
  }
  assert.match(html, new RegExp(`<a\\b(?=[^>]*\\bclass="[^"]*\\blang-selector\\b[^"]*")(?=[^>]*\\bhref="${escapeRegExp(expected.languageHref)}")(?=[^>]*\\bhreflang="${expected.languageCode === 'EN' ? 'el' : 'en'}")(?=[^>]*\\baria-label="${escapeRegExp(expected.language)}")[^>]*>\\s*<span[^>]*>${expected.languageCode}</span>`, 'u'));
}

function assertTranslationBoundaries(html, isHome, editorialClass) {
  assert.doesNotMatch(html, /<meta\b(?=[^>]*\bname="google")(?=[^>]*\bcontent="notranslate")[^>]*>/u, 'Google translation suppression is forbidden');
  const headers = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/gu) ?? [];
  assert.equal(headers.length, 1, 'expected exactly one sole navigation-bearing header');
  const [header] = headers;
  assert.match(header, /<header\b(?=[^>]*\bclass="[^"]*\bheader\b[^"]*")(?=[^>]*\bclass="[^"]*\bnotranslate\b[^"]*")(?=[^>]*\btranslate="no")[^>]*>/u);
  assert.match(header, /<nav\b[^>]*\bclass="[^"]*\bnav-menu\b[^"]*"/u);
  assert.match(header, /<nav\b[^>]*\bclass="[^"]*\bmobile-nav\b[^"]*"/u);
  assert.doesNotMatch(html, /<(?:html|body|main)\b[^>]*\b(?:class="[^"]*\bnotranslate\b[^"]*"|translate="no")/u);
  assertUnmarkedEditorialRoot(html, editorialClass);
  if (!isHome) return;
  assert.match(html, /<div\b(?=[^>]*\bclass="[^"]*\bhero-content\b[^"]*")(?=[^>]*\bclass="[^"]*\bnotranslate\b[^"]*")(?=[^>]*\btranslate="no")[^>]*>/u);
  assert.match(html, /<div\b(?=[^>]*\bclass="[^"]*\bfilter-tabs\b[^"]*")(?=[^>]*\bclass="[^"]*\bnotranslate\b[^"]*")(?=[^>]*\btranslate="no")[^>]*>/u);
}

function assertUnmarkedEditorialRoot(html, className) {
  const roots = [...html.matchAll(new RegExp(`<[^>]+\\bclass="(?:${escapeRegExp(className)}(?=\\s|")|[^"]*\\s${escapeRegExp(className)}(?=\\s|"))[^"]*"[^>]*>`, 'gu'))];
  assert.equal(roots.length, 1, `expected exactly one .${className} editorial root`);
  assert.doesNotMatch(roots[0][0], /(?:class="[^"]*\bnotranslate\b[^"]*"|translate="no")/u, `.${className} must remain eligible for translation`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function requireBuiltStandaloneEntry() {
  try {
    await access(standaloneEntry);
  } catch {
    throw new Error('Built standalone entry dist/server/entry.mjs is missing. Run npm run build before npm run standalone:test.');
  }
}

async function freeLoopbackPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function startStandalone({ baseUrl, databaseUrl, mediaRoot, port }) {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      MEDIA_ROOT: mediaRoot,
      PUBLIC_SITE_URL: 'https://miracon.gr',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-8_000);
    });
  }
  return child;
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode) {
      throw new Error(`Standalone server exited before readiness:\n${server.output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch (error) {
      if (!(error instanceof TypeError || error.name === 'TimeoutError')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Standalone server did not become healthy within 90 seconds:\n${server.output}`);
}

async function stopStandalone(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await once(server, 'exit');
  }
}
