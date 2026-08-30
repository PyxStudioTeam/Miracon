import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedProjects } from '../src/data/projects';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { provisionSingletonAdmin } from '../scripts/provision-admin.mjs';
import { GET as getSession } from '../src/pages/api/auth/session';
import { POST as bootstrapCsrf } from '../src/pages/api/auth/csrf';
import { POST as login } from '../src/pages/api/auth/login';
import { POST as logout } from '../src/pages/api/auth/logout';
import { GET as getProjects, POST as saveProject } from '../src/pages/api/admin/projects';
import { DELETE as deleteProject } from '../src/pages/api/admin/projects/[id]';
import { POST as reorderProjects } from '../src/pages/api/admin/projects/reorder';
import { GET as getHero, PUT as putHero } from '../src/pages/api/admin/home-hero';
import { GET as getSettings, PUT as putSettings } from '../src/pages/api/admin/site-settings';
import { POST as uploadMedia } from '../src/pages/api/admin/media';
import { GET as getMedia, HEAD as headMedia } from '../src/pages/media/[...path]';
import { GET as health } from '../src/pages/api/health';

const databaseUrl = requireSafeDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const temporaryRoots: string[] = [];
const siteUrl = 'https://miracon.test';

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
  await provisionSingletonAdmin({
    databaseUrl,
    email: 'admin@miracon.test',
    password: 'correct horse battery staple',
    rotate: false,
  });
}, 30_000);

beforeEach(() => {
  vi.stubEnv('PUBLIC_SITE_URL', siteUrl);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await pool.query('delete from miracon.login_throttle');
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

afterAll(async () => {
  await pool.end();
});

describe('Phase 2 server API', () => {
  it('authenticates, reports a session, and revokes it with CSRF and origin protection', async () => {
    // Given
    const response = await login(context('/api/auth/login', {
      method: 'POST', headers: { origin: siteUrl }, body: JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' }),
    }));
    const cookie = requireCookie(response);
    const loginBody = await response.json() as { readonly csrfToken: string };
    const session = await getSession(context('/api/auth/session', { headers: { cookie } }));
    const sessionBody = await session.json() as { readonly authenticated: boolean; readonly role: string };

    // When
    const blockedLogout = await logout(context('/api/auth/logout', { method: 'POST', headers: { cookie } }));
    const logoutResponse = await logout(context('/api/auth/logout', {
      method: 'POST', headers: { cookie, origin: siteUrl, 'x-csrf-token': loginBody.csrfToken },
    }));

    // Then
    expect(response.status).toBe(200);
    expect(loginBody.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(sessionBody).toMatchObject({ authenticated: true, role: 'owner' });
    expect(blockedLogout.status).toBe(403);
    expect(logoutResponse.status).toBe(204);
    expect((await getSession(context('/api/auth/session', { headers: { cookie } }))).status).toBe(401);
  });

  it('rejects generic bad login credentials and enforces protected project operations', async () => {
    // Given
    const rejected = await login(context('/api/auth/login', {
      method: 'POST', headers: { origin: siteUrl }, body: JSON.stringify({ email: 'missing@miracon.test', password: 'wrong password' }),
    }));
    const auth = await loginAsAdmin();
    const project = structuredClone(seedProjects[0]);
    if (!project) throw new Error('Project fixture source is required');
    const saved = { ...project, id: 'api-project', slug: 'api-project', status: 'draft' as const, sortOrder: 0 };

    // When
    const deniedRead = await getProjects(context('/api/admin/projects'));
    const stored = await saveProject(context('/api/admin/projects', {
      method: 'POST', headers: auth.headers,
      body: JSON.stringify({ project: saved, expectedRevisionId: null, mediaFileIds: [] }),
    }));
    const storedBody = await stored.json() as { readonly project: { readonly currentRevisionId: string } };
    const reordered = await reorderProjects(context('/api/admin/projects/reorder', {
      method: 'POST', headers: auth.headers, body: JSON.stringify({ items: [{ id: saved.id, sortOrder: 0 }] }),
    }));
    const deleted = await deleteProject(context('/api/admin/projects/api-project', {
      method: 'DELETE', headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedCurrentRevisionId: storedBody.project.currentRevisionId }),
    }, { id: saved.id }));

    // Then
    expect(rejected).toMatchObject({ status: 401 });
    expect(await rejected.json()).toEqual({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
    expect(deniedRead.status).toBe(401);
    expect(stored.status).toBe(201);
    expect(reordered.status).toBe(204);
    expect(deleted.status).toBe(204);
  });

  it('returns the canonical stored project when its database timestamp is omitted', async () => {
    // Given
    const auth = await loginAsAdmin();
    const project = structuredClone(seedProjects[0]);
    if (!project) throw new Error('Project fixture source is required');
    const { updatedAt: _updatedAt, ...input } = {
      ...project,
      id: 'api-canonical-project',
      slug: 'api-canonical-project',
      status: 'draft' as const,
      sortOrder: 9,
    };

    // When
    const response = await saveProject(context('/api/admin/projects', {
      method: 'POST', headers: auth.headers,
      body: JSON.stringify({ project: input, expectedRevisionId: null, mediaFileIds: [] }),
    }));
    const body = await response.json() as { readonly project: { readonly id: string; readonly updatedAt: string } };
    const read = await getProjects(context('/api/admin/projects', { headers: auth.headers }));
    const projects = await read.json() as { readonly projects: readonly { readonly id: string; readonly updatedAt: string }[] };

    // Then
    expect(response.status).toBe(201);
    expect(body.project.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(body.project).toEqual(projects.projects.find((candidate) => candidate.id === input.id));
  });

  it('governs owner draft, publish, conflict, media, audit, and delete project operations', async () => {
    // Given
    process.env.MEDIA_ROOT = await temporaryRoot();
    const auth = await loginAsAdmin();
    const form = new FormData();
    form.set('file', new File([Buffer.concat([mp4Signature(), Buffer.from('revision')])], 'revision.mp4', { type: 'video/mp4' }));
    const upload = await uploadMedia(context('/api/admin/media', {
      method: 'POST', headers: { ...auth.headers, 'content-length': '1024' }, body: form,
    }));
    const uploaded = await upload.json() as { readonly media: { readonly id: string; readonly relativeUrl: string; readonly relativePath: string } };
    const source = structuredClone(seedProjects[0]);
    if (!source) throw new Error('Project fixture source is required');
    const draft = {
      ...source,
      id: 'governed-api-project',
      slug: 'governed-api-project',
      status: 'draft' as const,
      sortOrder: 20,
      heroUrl: uploaded.media.relativeUrl,
      cardImages: source.cardImages.map((image) => ({ ...image, id: `governed-${image.id}` })),
      gallery: source.gallery.map((image) => ({ ...image, id: `governed-${image.id}` })),
    };

    // When
    const draftResponse = await saveProject(context('/api/admin/projects', {
      method: 'POST', headers: auth.headers,
      body: JSON.stringify({ project: draft, expectedRevisionId: null, mediaFileIds: [uploaded.media.id] }),
    }));
    const draftBody = await draftResponse.json() as { readonly project: {
      readonly currentRevisionId: string;
      readonly status: string;
      readonly managedMedia: readonly { readonly id: string; readonly relativeUrl: string; readonly relativePath: string }[];
    } };
    const publishedResponse = await saveProject(context('/api/admin/projects', {
      method: 'POST', headers: auth.headers,
      body: JSON.stringify({
        project: { ...draft, status: 'published' },
        expectedRevisionId: draftBody.project.currentRevisionId,
        mediaFileIds: [uploaded.media.id],
      }),
    }));
    const publishedBody = await publishedResponse.json() as { readonly project: { readonly currentRevisionId: string } };
    const stale = await saveProject(context('/api/admin/projects', {
      method: 'POST', headers: auth.headers,
      body: JSON.stringify({ project: draft, expectedRevisionId: draftBody.project.currentRevisionId, mediaFileIds: [uploaded.media.id] }),
    }));
    const deletion = await deleteProject(context('/api/admin/projects/governed-api-project', {
      method: 'DELETE', headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedCurrentRevisionId: publishedBody.project.currentRevisionId }),
    }, { id: draft.id }));
    const evidence = await pool.query(`select
      (select array_agg(action::text order by revision_number) from miracon.content_revisions where aggregate_id = $1) as revision_actions,
      (select array_agg(audit.action::text order by revision.revision_number) from miracon.audit_events as audit join miracon.content_revisions as revision on revision.id = audit.revision_id where audit.aggregate_id = $1) as audit_actions,
      (select array_agg(audit.actor_id order by revision.revision_number) from miracon.audit_events as audit join miracon.content_revisions as revision on revision.id = audit.revision_id where audit.aggregate_id = $1) as audit_actors,
      (select count(*)::integer from miracon.revision_media where media_file_id = $2) as media_links,
      (select count(*)::integer from miracon.projects where id = $1) as live_projects,
      (select revision.action::text from miracon.content_revision_heads as head join miracon.content_revisions as revision on revision.id = head.current_revision_id where head.aggregate_type = 'project' and head.aggregate_id = $1) as head_action,
      (select snapshot->'project'->>'published_at' from miracon.content_revisions where id = $3) as published_at`,
    [draft.id, uploaded.media.id, publishedBody.project.currentRevisionId]);

    // Then
    expect(draftResponse.status).toBe(201);
    expect(draftBody.project.status).toBe('draft');
    expect(draftBody.project.managedMedia).toEqual([{ id: uploaded.media.id, relativeUrl: uploaded.media.relativeUrl, relativePath: uploaded.media.relativePath }]);
    expect(publishedResponse.status).toBe(201);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: 'revision_conflict', message: 'Content changed since it was loaded' } });
    expect(deletion.status).toBe(204);
    expect(evidence.rows[0]).toMatchObject({
      revision_actions: ['publish', 'publish', 'delete'],
      audit_actions: ['publish', 'publish', 'delete'],
      audit_actors: [1, 1, 1],
      media_links: 2,
      live_projects: 0,
      head_action: 'delete',
    });
    expect(evidence.rows[0].published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('reads and updates protected hero and site settings resources', async () => {
    // Given
    const auth = await loginAsAdmin();
    const videos = [{ id: 'api-hero', title: 'API hero', projectId: null, desktopUrl: '/media/api.mp4', desktopStoragePath: null, mobileUrl: null, mobileStoragePath: null, sortOrder: 0, isActive: true }];
    const settings = { footerTermsVisible: true, footerTermsPdfUrl: '/media/legal/terms.pdf', footerPrivacyVisible: false, footerPrivacyPdfUrl: '', footerCookieVisible: false, footerCookiePdfUrl: '' };

    // When
    const heroUpdate = await putHero(context('/api/admin/home-hero', { method: 'PUT', headers: auth.headers, body: JSON.stringify({ videos }) }));
    const settingsUpdate = await putSettings(context('/api/admin/site-settings', { method: 'PUT', headers: auth.headers, body: JSON.stringify(settings) }));
    const heroRead = await getHero(context('/api/admin/home-hero', { headers: auth.headers }));
    const settingsRead = await getSettings(context('/api/admin/site-settings', { headers: auth.headers }));

    // Then
    expect(heroUpdate.status).toBe(204);
    expect(settingsUpdate.status).toBe(200);
    expect(await heroRead.json()).toEqual({ videos });
    expect(await settingsRead.json()).toEqual({ settings });
  });

  it('uploads and safely serves local media with GET, HEAD, and byte ranges', async () => {
    // Given
    process.env.MEDIA_ROOT = await temporaryRoot();
    const auth = await loginAsAdmin();
    const form = new FormData();
    const source = Buffer.concat([mp4Signature(), Buffer.from('0123456789')]);
    form.set('file', new File([source], 'clip.mp4', { type: 'video/mp4' }));

    // When
    const uploaded = await uploadMedia(context('/api/admin/media', { method: 'POST', headers: { ...auth.headers, 'content-length': '1024' }, body: form }));
    const saved = await uploaded.json() as { readonly media: { readonly relativePath: string; readonly mimeType: string; readonly sha256: string } };
    const start = mp4Signature().length + 2;
    const ranged = await getMedia(context(`/media/${saved.media.relativePath}`, { headers: { range: `bytes=${start}-${start + 3}` } }, { path: saved.media.relativePath }));
    const headed = await headMedia(context(`/media/${saved.media.relativePath}`, {}, { path: saved.media.relativePath }));

    // Then
    expect(uploaded.status).toBe(201);
    expect(saved.media.mimeType).toBe('video/mp4');
    expect(saved.media.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes ${start}-${start + 3}/${source.length}`);
    expect(await ranged.text()).toBe('2345');
    expect(headed.status).toBe(200);
    expect(headed.headers.get('content-length')).toBe(String(source.length));
    expect(await headed.text()).toBe('');
  });

  it('reports only database and media health state', async () => {
    // Given
    process.env.MEDIA_ROOT = await temporaryRoot();

    // When
    const response = await health();

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, database: true, media: true });
  });

  it('requires a same-origin login request before inspecting credentials', async () => {
    // Given
    const body = JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' });

    // When
    const missingOrigin = await login(context('/api/auth/login', { method: 'POST', body }));
    const foreignOrigin = await login(context('/api/auth/login', {
      method: 'POST', headers: { origin: 'https://evil.example' }, body,
    }));

    // Then
    expect(missingOrigin.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
  });

  it('accepts the canonical origin when the request URL is internal behind a proxy', async () => {
    // Given
    vi.stubEnv('PUBLIC_SITE_URL', siteUrl);
    const internalBase = 'http://miracon.test';
    const body = JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' });
    const project = structuredClone(seedProjects[0]);
    if (!project) throw new Error('Project fixture source is required');
    const proxyProject = {
      ...project,
      id: 'proxy-project',
      slug: 'proxy-project',
      status: 'draft' as const,
      sortOrder: 0,
      cardImages: project.cardImages.map((image) => ({ ...image, id: `proxy-${image.id}` })),
      gallery: project.gallery.map((image) => ({ ...image, id: `proxy-${image.id}` })),
    };

    // When
    const loginResponse = await login(context('/api/auth/login', {
      method: 'POST', headers: { origin: siteUrl }, body,
    }, {}, internalBase));
    const cookie = requireCookie(loginResponse);
    const loginBody = await loginResponse.json() as { readonly csrfToken: string };
    const internalLogin = await login(context('/api/auth/login', {
      method: 'POST', headers: { origin: internalBase }, body,
    }, {}, internalBase));
    const saved = await saveProject(context('/api/admin/projects', {
      method: 'POST',
      headers: { cookie, origin: siteUrl, 'x-csrf-token': loginBody.csrfToken },
      body: JSON.stringify({ project: proxyProject, expectedRevisionId: null, mediaFileIds: [] }),
    }, {}, internalBase));
    const bootstrap = await bootstrapCsrf(context('/api/auth/csrf', {
      method: 'POST', headers: { cookie, origin: siteUrl },
    }, {}, internalBase));

    // Then
    expect(loginResponse.status).toBe(200);
    expect(internalLogin.status).toBe(403);
    expect(saved.status).toBe(201);
    expect(bootstrap.status).toBe(200);
  });

  it('rotates an authenticated session CSRF token after a reload bootstrap', async () => {
    // Given
    const auth = await loginAsAdmin();
    const oldToken = auth.headers['x-csrf-token'];

    // When
    const bootstrap = await bootstrapCsrf(context('/api/auth/csrf', {
      method: 'POST', headers: { cookie: auth.headers.cookie, origin: siteUrl },
    }));
    const body = await bootstrap.json() as { readonly csrfToken: string };
    const staleLogout = await logout(context('/api/auth/logout', {
      method: 'POST', headers: { ...auth.headers, 'x-csrf-token': oldToken },
    }));
    const refreshedLogout = await logout(context('/api/auth/logout', {
      method: 'POST', headers: { ...auth.headers, 'x-csrf-token': body.csrfToken },
    }));

    // Then
    expect(bootstrap.status).toBe(200);
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(body.csrfToken).not.toBe(oldToken);
    expect(staleLogout.status).toBe(403);
    expect(refreshedLogout.status).toBe(204);
  });

  it('cannot bypass login throttling by rotating User-Agent headers', async () => {
    // Given
    const clientAddress = '198.51.100.26';
    const failedLogins = Array.from({ length: 5 }, (_, index) => login(context('/api/auth/login', {
      method: 'POST',
      clientAddress,
      headers: { origin: siteUrl, 'user-agent': `rotating-agent-${index}` },
      body: JSON.stringify({ email: 'admin@miracon.test', password: 'wrong password' }),
    })));

    // When
    await Promise.all(failedLogins);
    const correctCredentials = await login(context('/api/auth/login', {
      method: 'POST',
      clientAddress,
      headers: { origin: siteUrl, 'user-agent': 'new-agent' },
      body: JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' }),
    }));

    // Then
    expect(correctCredentials.status).toBe(401);
  });

  it('keeps spoofed forwarded addresses in the stable unknown throttle bucket', async () => {
    // Given
    const failedLogins = Array.from({ length: 5 }, (_, index) => login(context('/api/auth/login', {
      method: 'POST',
      headers: { origin: siteUrl, 'user-agent': `rotating-agent-${index}`, 'x-forwarded-for': `198.51.100.${index}` },
      body: JSON.stringify({ email: 'admin@miracon.test', password: 'wrong password' }),
    })));

    // When
    await Promise.all(failedLogins);
    const correctCredentials = await login(context('/api/auth/login', {
      method: 'POST',
      headers: { origin: siteUrl, 'x-forwarded-for': '203.0.113.1' },
      body: JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' }),
    }));

    // Then
    expect(correctCredentials.status).toBe(401);
  });
});

type AuthHeaders = {
  readonly cookie: string;
  readonly origin: string;
  readonly 'x-csrf-token': string;
};

async function loginAsAdmin(): Promise<{ readonly headers: AuthHeaders }> {
  const response = await login(context('/api/auth/login', {
    method: 'POST', headers: { origin: siteUrl }, body: JSON.stringify({ email: 'admin@miracon.test', password: 'correct horse battery staple' }),
  }));
  const cookie = requireCookie(response);
  const body = await response.json() as { readonly csrfToken: string };
  return { headers: { cookie, origin: siteUrl, 'x-csrf-token': body.csrfToken } };
}

function context(path: string, init: RequestInit & { readonly clientAddress?: string } = {}, params: Record<string, string> = {}, base = siteUrl) {
  return { request: new Request(`${base}${path}`, init), params, clientAddress: init.clientAddress };
}

function requireCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('Expected session cookie');
  return value.split(';', 1)[0] ?? '';
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miracon-api-media-'));
  temporaryRoots.push(root);
  return root;
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

function mp4Signature(): Buffer {
  return Buffer.from('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom', 'binary');
}
