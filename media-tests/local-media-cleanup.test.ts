import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import {
  LocalMediaCleanupError,
  parseLocalMediaCleanupArguments,
  runLocalMediaCleanup,
} from '../scripts/local-media-cleanup.mjs';

const databaseUrl = requireSafeDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const temporaryRoots: string[] = [];
const now = new Date('2026-08-20T12:00:00.000Z');
const oldDate = new Date('2026-08-01T12:00:00.000Z');

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
}, 30_000);

beforeEach(async () => {
  await pool.query(`
    truncate miracon.projects cascade;
    delete from miracon.media_files;
    delete from miracon.homepage_videos;
    update miracon.site_settings set
      footer_terms_visible = false, footer_terms_pdf_url = '',
      footer_privacy_visible = false, footer_privacy_pdf_url = '',
      footer_cookie_visible = false, footer_cookie_pdf_url = ''
  `);
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

afterAll(async () => {
  await pool.end();
});

describe('local media cleanup reference discovery', () => {
  it('retains media referenced by every authoritative URL, path, and JSON surface', async () => {
    // Given
    const root = await temporaryRoot();
    const references = [
      'cover', 'variant-key', 'variant-src', 'hero', 'hero-mobile', 'hero-poster',
      'hero-playlist', 'hero-playlist-mobile', 'hero-playlist-poster',
      'walkthrough', 'walkthrough-mobile', 'walkthrough-poster',
      'walkthrough-playlist', 'walkthrough-playlist-mobile', 'walkthrough-playlist-poster',
      'intro', 'brochure', 'benefit', 'floor-plan', 'project-image-url',
      'project-image-path', 'homepage-url', 'homepage-path', 'settings',
    ];
    await Promise.all(references.map((id) => insertMedia(id, oldDate)));
    await pool.query(`
      insert into miracon.projects (
        id, slug, title, cover_url, image_variants,
        hero_url, hero_mobile_url, hero_poster_url, hero_videos,
        walkthrough_video_desktop_url, walkthrough_video_mobile_url,
        walkthrough_video_poster_url, walkthrough_videos, intro_image_url,
        brochure_url, benefits, floor_plan_groups
      ) values (
        $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb,
        $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb, $17::jsonb
      )
    `, [
      'project', 'referenced-project', 'Referenced project', mediaUrl('cover'),
      JSON.stringify({ version: 1, images: { [mediaUrl('variant-key')]: { webp: [{ src: mediaUrl('variant-src'), width: 800 }] } } }),
      mediaUrl('hero'), mediaUrl('hero-mobile'), mediaUrl('hero-poster'),
      JSON.stringify([{ id: 'hero-video', desktopUrl: mediaUrl('hero-playlist'), mobileUrl: mediaUrl('hero-playlist-mobile'), posterUrl: mediaUrl('hero-playlist-poster') }]),
      mediaUrl('walkthrough'), mediaUrl('walkthrough-mobile'), mediaUrl('walkthrough-poster'),
      JSON.stringify([{ id: 'walkthrough-video', desktopUrl: mediaUrl('walkthrough-playlist'), mobileUrl: mediaUrl('walkthrough-playlist-mobile'), posterUrl: mediaUrl('walkthrough-playlist-poster') }]),
      mediaUrl('intro'), mediaUrl('brochure'),
      JSON.stringify([{ id: 'benefit', title: 'Benefit', icon: mediaUrl('benefit') }]),
      JSON.stringify([{ id: 'group', title: 'Plans', plans: [{ id: 'plan', title: 'Plan', imageUrl: mediaUrl('floor-plan'), alt: '' }] }]),
    ]);
    await pool.query(`insert into miracon.project_images (id, project_id, url, storage_path, role) values
      ('image-url', 'project', $1, null, 'card'),
      ('image-path', 'project', '/external/image.jpg', $2, 'gallery')`, [mediaUrl('project-image-url'), mediaPath('project-image-path')]);
    await pool.query(`insert into miracon.homepage_videos (id, desktop_url, mobile_url, mobile_storage_path) values
      ('homepage', $1, 'https://external.test/video.mp4', $2)`, [mediaUrl('homepage-url'), mediaPath('homepage-path')]);
    await pool.query('update miracon.site_settings set footer_terms_pdf_url = $1', [mediaUrl('settings')]);

    // When
    const result = await runLocalMediaCleanup({ database: pool, mediaRoot: root, siteOrigin: 'https://miracon.test', now, graceDays: 7, apply: false });

    // Then
    expect(result).toMatchObject({ dryRun: true, candidates: [], deleted: [] });
  });

  it('retains a newly orphaned upload during the grace period and defaults the CLI to dry-run', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('new-orphan', new Date('2026-08-19T12:00:00.000Z'));

    // When
    const options = parseLocalMediaCleanupArguments([]);
    const result = await runLocalMediaCleanup({ database: pool, mediaRoot: root, siteOrigin: 'https://miracon.test', now, graceDays: options.graceDays, apply: options.apply });

    // Then
    expect(options).toEqual({ apply: false, exclusiveWriter: false, graceDays: 7 });
    expect(result).toMatchObject({ dryRun: true, candidates: [], deleted: [] });
  });

  it('does not treat an unknown external URL as a reference to local media', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('external-only', oldDate);
    await pool.query('insert into miracon.projects (id, slug, title, cover_url) values ($1, $2, $3, $4)', [
      'external-project', 'external-project', 'External project', 'https://cdn.example.test/media/uploads/external-only/external-only.bin',
    ]);

    // When
    const result = await runLocalMediaCleanup({ database: pool, mediaRoot: root, siteOrigin: 'https://miracon.test', now, graceDays: 7, apply: false });

    // Then
    expect(result.candidates).toMatchObject([{ id: 'external-only', relativePath: mediaPath('external-only') }]);
  });

  it('retains query, fragment, and exact canonical-site absolute URL aliases', async () => {
    // Given
    const root = await temporaryRoot();
    await Promise.all(['query-alias', 'path-alias', 'absolute-alias'].map((id) => insertMedia(id, oldDate)));
    await pool.query(`insert into miracon.projects (id, slug, title, cover_url, hero_url, intro_image_url)
      values ($1, $2, $3, $4, $5, $6)`, [
      'alias-project', 'alias-project', 'Alias project',
      `${mediaUrl('query-alias')}?width=1600`,
      `${mediaPath('path-alias')}#poster`,
      `https://miracon.test${mediaUrl('absolute-alias')}?download=1#asset`,
    ]);

    // When
    const result = await runLocalMediaCleanup({
      database: pool,
      mediaRoot: root,
      siteOrigin: 'https://miracon.test',
      now,
      graceDays: 7,
      apply: false,
    });

    // Then
    expect(result.candidates).toEqual([]);
  });

  it('excludes old media referenced only by revision history from dry-run candidates', async () => {
    // Given
    const root = await temporaryRoot();
    const mediaId = 'revision-history-dry-run';
    const aggregateId = 'revision-history-dry-run-project';
    await insertMedia(mediaId, oldDate);
    await pool.query(`with revision as (
      insert into miracon.content_revisions
        (aggregate_type, aggregate_id, revision_number, state, action, snapshot, approved_at)
      values ('project', $1, 1, 'approved', 'baseline', $2::jsonb, clock_timestamp())
      returning id
    )
    insert into miracon.revision_media (revision_id, media_file_id)
    select id, $3 from revision`, [
      aggregateId,
      JSON.stringify({ aggregateType: 'project', aggregateId, deleted: true, project: null, images: [] }),
      mediaId,
    ]);

    // When
    const result = await runLocalMediaCleanup({ database: pool, mediaRoot: root, siteOrigin: 'https://miracon.test', now, graceDays: 7, apply: false });

    // Then
    expect(result).toMatchObject({ dryRun: true, candidates: [], deleted: [] });
  });
});

async function insertMedia(id: string, createdAt: Date): Promise<void> {
  await pool.query(`insert into miracon.media_files
    (id, relative_url, relative_path, mime_type, size_bytes, sha256, created_at)
    values ($1, $2, $3, 'application/octet-stream', 1, decode(repeat('00', 32), 'hex'), $4)`,
  [id, mediaUrl(id), mediaPath(id), createdAt]);
}

function mediaUrl(id: string): string {
  return `/media/${mediaPath(id)}`;
}

function mediaPath(id: string): string {
  return `uploads/${id}/${id}.bin`;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-cleanup-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'uploads'));
  return root;
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}
