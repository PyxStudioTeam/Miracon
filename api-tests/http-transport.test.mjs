import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, copyFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { provisionSingletonAdmin } from '../scripts/provision-admin.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';

const admin = { email: 'admin@miracon.test', password: 'correct horse battery staple' };

test('serves Phase 2 APIs over real loopback HTTP', { timeout: 180_000 }, async () => {
  const databaseUrl = testDatabaseUrl();
  const mediaRoot = await mkdtemp(join(tmpdir(), 'miracon-http-media-'));
  const astroRoot = await mkdtemp(join(tmpdir(), 'miracon-http-astro-'));
  const database = await openClient(databaseUrl, 'miracon-http-transport-test');
  let server;
  try {
    await resetSchemas(database, databaseUrl);
    await migrate(databaseUrl);
    await provisionSingletonAdmin({ databaseUrl, ...admin });

    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await linkAstroProject({ astroRoot });
    server = startAstro({ astroRoot, baseUrl, databaseUrl, mediaRoot, port });
    await waitForHealth(baseUrl, server);

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, database: true, media: true });

    const credentials = JSON.stringify(admin);
    await assertApiError(fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: credentials,
    }), 403, 'origin_failed');
    await assertApiError(fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: credentials,
    }), 403, 'origin_failed');

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: credentials,
    });
    assert.equal(login.status, 200);
    const setCookie = requiredHeader(login, 'set-cookie');
    for (const attribute of ['__Host-session=', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) {
      assert.match(setCookie, new RegExp(attribute, 'u'));
    }
    const sessionCookie = setCookie.split(';', 1)[0];
    assert.ok(sessionCookie);
    const loginBody = await login.json();
    const csrfToken = loginBody.csrfToken;
    assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/u);

    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sessionCookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).authenticated, true);

    const bootstrap = await fetch(`${baseUrl}/api/auth/csrf`, {
      method: 'POST', headers: { cookie: sessionCookie, origin: baseUrl },
    });
    assert.equal(bootstrap.status, 200);
    const refreshedCsrf = (await bootstrap.json()).csrfToken;
    assert.match(refreshedCsrf, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(refreshedCsrf, csrfToken);

    const mutations = [
      ['POST', '/api/admin/projects'],
      ['POST', '/api/admin/projects/reorder'],
      ['DELETE', '/api/admin/projects/not-created'],
      ['PUT', '/api/admin/home-hero'],
      ['PUT', '/api/admin/site-settings'],
      ['POST', '/api/admin/media'],
      ['POST', '/api/auth/logout'],
    ];
    for (const [method, path] of mutations) {
      await assertApiError(fetch(`${baseUrl}${path}`, { method, headers: { cookie: sessionCookie, origin: baseUrl, 'content-type': 'application/json' } }), 403, 'csrf_failed');
      await assertApiError(fetch(`${baseUrl}${path}`, { method, headers: { cookie: sessionCookie, origin: baseUrl, 'content-type': 'application/json', 'x-csrf-token': 'wrong' } }), 403, 'csrf_failed');
      await assertApiError(fetch(`${baseUrl}${path}`, { method, headers: { cookie: sessionCookie, origin: 'https://evil.example', 'content-type': 'application/json', 'x-csrf-token': refreshedCsrf } }), 403, 'origin_failed');
    }

    const authHeaders = { cookie: sessionCookie, origin: baseUrl, 'x-csrf-token': refreshedCsrf, 'content-type': 'application/json' };
    const saved = await fetch(`${baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(projectSaveBody(projectFixture({
        title: 'PostgreSQL draft project',
        translations: { el: { title: 'Πρόχειρο έργο PostgreSQL' } },
      }))),
    });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).project.id, 'http-transport-project');

    const published = await fetch(`${baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(projectSaveBody(projectFixture({
        id: 'postgres-public-project',
        slug: 'postgres-public-project',
        title: 'PostgreSQL public project',
        status: 'published',
        translations: { el: { title: 'Δημόσιο έργο PostgreSQL' } },
      }))),
    });
    assert.equal(published.status, 201);

    const homepageVideos = await fetch(`${baseUrl}/api/admin/home-hero`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ videos: [{
        id: 'postgres-home-video', title: 'PostgreSQL home video', projectId: null,
        desktopUrl: '/media/postgres-home.mp4', desktopStoragePath: null,
        mobileUrl: null, mobileStoragePath: null, sortOrder: 0, isActive: true,
      }] }),
    });
    // Hero saves now return the materialized playlist with its revision head.
    assert.equal(homepageVideos.status, 200);
    const homepageVideosBody = await homepageVideos.json();
    assert.equal(homepageVideosBody.videos[0].id, 'postgres-home-video');
    assert.ok('currentRevisionId' in homepageVideosBody);

    // Legal documents must resolve to an uploaded catalog PDF, so external URLs are rejected.
    await assertApiError(fetch(`${baseUrl}/api/admin/site-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        footerTermsVisible: true, footerTermsPdfUrl: 'https://miracon.test/terms.pdf',
        footerPrivacyVisible: false, footerPrivacyPdfUrl: '',
        footerCookieVisible: false, footerCookiePdfUrl: '',
      }),
    }), 400, 'invalid_media');

    const uploadedTerms = await upload(baseUrl, authHeaders, pdfSignature(), {
      filename: 'terms.pdf',
      mimeType: 'application/pdf',
    });
    assert.equal(uploadedTerms.status, 201);
    const termsPdfUrl = (await uploadedTerms.json()).media.relativeUrl;

    const siteSettings = await fetch(`${baseUrl}/api/admin/site-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        footerTermsVisible: true, footerTermsPdfUrl: termsPdfUrl,
        footerPrivacyVisible: false, footerPrivacyPdfUrl: '',
        footerCookieVisible: false, footerCookiePdfUrl: '',
      }),
    });
    assert.equal(siteSettings.status, 200);

    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.equal(requiredHeader(home, 'cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400');
    const homeHtml = await home.text();
    assert.match(homeHtml, /PostgreSQL public project/u);
    assert.doesNotMatch(homeHtml, /PostgreSQL draft project/u);
    assert.match(homeHtml, /postgres-home\.mp4/u);
    assert.ok(homeHtml.includes(termsPdfUrl));

    const greekHome = await fetch(`${baseUrl}/el/`);
    assert.equal(greekHome.status, 200);
    const greekHomeHtml = await greekHome.text();
    assert.match(greekHomeHtml, /Δημόσιο έργο PostgreSQL/u);
    assert.doesNotMatch(greekHomeHtml, /Πρόχειρο έργο PostgreSQL/u);

    const publicProject = await fetch(`${baseUrl}/projects/postgres-public-project`);
    assert.equal(publicProject.status, 200);
    assert.equal(requiredHeader(publicProject, 'cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400');
    assert.match(await publicProject.text(), /PostgreSQL public project/u);

    const greekPublicProject = await fetch(`${baseUrl}/el/projects/postgres-public-project`);
    assert.equal(greekPublicProject.status, 200);
    assert.equal(requiredHeader(greekPublicProject, 'cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400');
    assert.match(await greekPublicProject.text(), /Δημόσιο έργο PostgreSQL/u);

    const draftProject = await fetch(`${baseUrl}/projects/http-transport-project`);
    assert.equal(draftProject.status, 404);

    const greekDraftProject = await fetch(`${baseUrl}/el/projects/http-transport-project`);
    assert.equal(greekDraftProject.status, 404);

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.equal(requiredHeader(sitemap, 'cache-control'), 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    const sitemapXml = await sitemap.text();
    assert.match(sitemapXml, /postgres-public-project/u);
    assert.match(sitemapXml, /el\/projects\/postgres-public-project/u);
    assert.doesNotMatch(sitemapXml, /http-transport-project/u);

    const anonymousPreview = await fetch(`${baseUrl}/preview/http-transport-project`, { redirect: 'manual' });
    assert.equal(anonymousPreview.status, 302);
    assert.equal(requiredHeader(anonymousPreview, 'location'), '/admin');

    const anonymousGreekPreview = await fetch(`${baseUrl}/el/preview/http-transport-project`, { redirect: 'manual' });
    assert.equal(anonymousGreekPreview.status, 302);
    assert.equal(requiredHeader(anonymousGreekPreview, 'location'), '/admin');

    const preview = await fetch(`${baseUrl}/preview/http-transport-project`, { headers: { cookie: sessionCookie } });
    assert.equal(preview.status, 200);
    assert.equal(requiredHeader(preview, 'cache-control'), 'private, no-store');
    assert.equal(requiredHeader(preview, 'x-frame-options'), 'SAMEORIGIN');
    assert.match(requiredHeader(preview, 'content-security-policy'), /frame-ancestors 'self'/u);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /PostgreSQL draft project/u);
    assert.match(previewHtml, /noindex,nofollow,noarchive/u);

    const greekPreview = await fetch(`${baseUrl}/el/preview/http-transport-project`, { headers: { cookie: sessionCookie } });
    assert.equal(greekPreview.status, 200);
    assert.equal(requiredHeader(greekPreview, 'cache-control'), 'private, no-store');
    assert.equal(requiredHeader(greekPreview, 'x-frame-options'), 'SAMEORIGIN');
    assert.match(requiredHeader(greekPreview, 'content-security-policy'), /frame-ancestors 'self'/u);
    const greekPreviewHtml = await greekPreview.text();
    assert.match(greekPreviewHtml, /Πρόχειρο έργο PostgreSQL/u);
    assert.match(greekPreviewHtml, /noindex,nofollow,noarchive/u);

    await assertApiError(upload(baseUrl, authHeaders, Buffer.from('not an mp4')), 400, 'invalid_upload');
    const source = Buffer.concat([mp4Signature(), Buffer.from('0123456789')]);
    const uploaded = await upload(baseUrl, authHeaders, source);
    assert.equal(uploaded.status, 201);
    const media = (await uploaded.json()).media;
    assert.equal(media.mimeType, 'video/mp4');

    const full = await fetch(`${baseUrl}/media/${media.relativePath}`);
    assert.equal(full.status, 200);
    assert.equal(Number(requiredHeader(full, 'content-length')), source.length);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), source);
    const start = mp4Signature().length + 2;
    const ranged = await fetch(`${baseUrl}/media/${media.relativePath}`, { headers: { range: `bytes=${start}-${start + 3}` } });
    assert.equal(ranged.status, 206);
    assert.equal(requiredHeader(ranged, 'content-range'), `bytes ${start}-${start + 3}/${source.length}`);
    assert.equal(await ranged.text(), '2345');
    const headed = await fetch(`${baseUrl}/media/${media.relativePath}`, { method: 'HEAD' });
    assert.equal(headed.status, 200);
    assert.equal(Number(requiredHeader(headed, 'content-length')), source.length);
  } finally {
    await stopAstro(server);
    await database.end();
    await rm(mediaRoot, { recursive: true, force: true });
    await rm(astroRoot, { recursive: true, force: true });
  }
});

function testDatabaseUrl() {
  return requireSafeDatabaseTestUrl();
}

async function linkAstroProject({ astroRoot }) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  await Promise.all([
    copyFile(join(projectRoot, 'astro.config.mjs'), join(astroRoot, 'astro.config.mjs')),
    copyFile(join(projectRoot, 'package.json'), join(astroRoot, 'package.json')),
    cp(join(projectRoot, 'public'), join(astroRoot, 'public'), { recursive: true }),
    cp(join(projectRoot, 'src'), join(astroRoot, 'src'), { recursive: true }),
    symlink(join(projectRoot, 'node_modules'), join(astroRoot, 'node_modules'), 'junction'),
  ]);
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

function startAstro({ astroRoot, baseUrl, databaseUrl, mediaRoot, port }) {
  const entry = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry, 'dev', '--root', astroRoot, '--config', 'astro.config.mjs', '--host', '127.0.0.1', '--port', String(port), '--mode', 'test'], {
    cwd: astroRoot,
    env: { ...process.env, ASTRO_DEV_BACKGROUND: '0', DATABASE_URL: databaseUrl, MEDIA_ROOT: mediaRoot, PUBLIC_SITE_URL: baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { child.output = `${child.output}${chunk}`.slice(-8_000); });
  return child;
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode) throw new Error(`Astro dev exited before health check:\n${server.output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch (error) {
      if (!(error instanceof TypeError || error.name === 'TimeoutError')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Astro dev did not become healthy within 90 seconds:\n${server.output}`);
}

async function stopAstro(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

function upload(baseUrl, headers, bytes, { filename = 'clip.mp4', mimeType = 'video/mp4' } = {}) {
  const boundary = 'miracon-http-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`${baseUrl}/api/admin/media`, {
    method: 'POST',
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
    body,
  });
}

async function assertApiError(response, status, code) {
  const result = await response;
  assert.equal(result.status, status);
  assert.match(await result.text(), new RegExp(`"code":"${code}"`, 'u'));
}

function requiredHeader(response, name) {
  const value = response.headers.get(name);
  assert.ok(value, `Missing ${name} header`);
  return value;
}

function projectSaveBody(project, { expectedRevisionId = null, mediaFileIds = [] } = {}) {
  return { project, expectedRevisionId, mediaFileIds };
}

function projectFixture({
  id = 'http-transport-project',
  slug = 'http-transport-project',
  title = 'HTTP transport',
  status = 'draft',
  translations,
} = {}) {
  return {
    id, slug, title, address: '', cardAddress: '', price: '', shortDescription: '', fullDescription: '', introTitle: '', categories: [], status, sortOrder: 0,
    coverUrl: '', coverFocalX: 50, coverFocalY: 50, heroType: 'image', heroVariant: 'standard', heroSoundEnabled: false, heroIdleUi: false, heroUrl: '', heroMobileUrl: null, heroPosterUrl: null, heroVideos: [],
    walkthroughVideoEnabled: false, walkthroughVideoTitle: '', walkthroughVideoDesktopUrl: '', walkthroughVideoMobileUrl: null, walkthroughVideoPosterUrl: null, walkthroughVideos: [], heroFocalX: 50, heroFocalY: 50,
    introImageUrl: '', brochureUrl: null, mapQuery: '', mapUrl: '', cardImages: [], gallery: [], characteristics: [], benefits: [], floorPlanGroups: [], nearbyPlaces: [], seoTitle: '', seoDescription: '',
    remainingUnits: null,
    ...(translations ? { translations } : {}),
  };
}

function pdfSignature() {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'binary');
}

function mp4Signature() {
  return Buffer.from('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom', 'binary');
}
