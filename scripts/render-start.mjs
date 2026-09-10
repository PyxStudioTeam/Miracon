import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from './postgres-migrate.mjs';
import { provisionSingletonAdmin } from './provision-admin.mjs';

async function main() {
  console.log('[Render Start] Initializing Miracon preview environment...');

  // 1. Normalize environment variables
  if (process.env.RENDER_EXTERNAL_URL && !process.env.PUBLIC_SITE_URL) {
    process.env.PUBLIC_SITE_URL = process.env.RENDER_EXTERNAL_URL;
  }
  if (process.env.PUBLIC_SITE_URL && !process.env.PUBLIC_SITE_URL.startsWith('http://') && !process.env.PUBLIC_SITE_URL.startsWith('https://')) {
    process.env.PUBLIC_SITE_URL = `https://${process.env.PUBLIC_SITE_URL}`;
  }
  process.env.ALLOW_PREVIEW_HOSTS = process.env.ALLOW_PREVIEW_HOSTS || 'true';
  process.env.HOST = process.env.HOST || '0.0.0.0';
  process.env.PORT = process.env.PORT || '10000';
  if (!process.env.MEDIA_ROOT) {
    process.env.MEDIA_ROOT = '/tmp/miracon-media';
  }
  if (!process.env.CONTACT_DIGEST_SECRET || process.env.CONTACT_DIGEST_SECRET.length < 32) {
    console.warn('[Render Start] CONTACT_DIGEST_SECRET missing or < 32 chars; generating fallback random secret');
    process.env.CONTACT_DIGEST_SECRET = randomBytes(32).toString('hex');
  }

  console.log(`[Render Start] PUBLIC_SITE_URL: ${process.env.PUBLIC_SITE_URL || '(unset)'}`);
  console.log(`[Render Start] MEDIA_ROOT: ${process.env.MEDIA_ROOT}`);

  // 2. Database migrations and initial seed setup
  if (process.env.DATABASE_URL) {
    console.log('[Render Start] Applying PostgreSQL migrations...');
    await migrate(process.env.DATABASE_URL);
    console.log('[Render Start] PostgreSQL migrations applied successfully.');

    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      application_name: 'miracon-render-start',
      connectionTimeoutMillis: 10_000,
      query_timeout: 60_000,
      statement_timeout: 60_000,
    });
    await client.connect();

    try {
      // Provision/rotate Owner account (admin@miracon.local)
      const ownerResult = await client.query('select id from miracon.admin_users where id = 1');
      if (ownerResult.rows.length === 0) {
        console.log('[Render Start] Provisioning initial owner (admin@miracon.local)...');
        await provisionSingletonAdmin({
          databaseUrl: process.env.DATABASE_URL,
          email: 'admin@miracon.local',
          password: 'MiraconSecureAdmin2026!',
          operation: { kind: 'provision-owner', email: 'admin@miracon.local' },
        });
      } else {
        console.log('[Render Start] Owner exists; ensuring active credentials (admin@miracon.local)...');
        await provisionSingletonAdmin({
          databaseUrl: process.env.DATABASE_URL,
          email: 'admin@miracon.local',
          password: 'MiraconSecureAdmin2026!',
          operation: { kind: 'rotate-owner', email: 'admin@miracon.local' },
        });
      }

      // Provision Editor account (editor@miracon.local)
      const editorResult = await client.query("select id from miracon.admin_users where role = 'editor' and email = 'editor@miracon.local'");
      if (editorResult.rows.length === 0) {
        console.log('[Render Start] Provisioning initial editor (editor@miracon.local)...');
        await provisionSingletonAdmin({
          databaseUrl: process.env.DATABASE_URL,
          email: 'editor@miracon.local',
          password: 'MiraconSecureEditor2026!',
          operation: { kind: 'provision-editor', email: 'editor@miracon.local' },
        });
      }

      // Seed initial projects if empty
      const countResult = await client.query('select count(*)::int as count from miracon.projects');
      if (countResult.rows[0].count === 0) {
        console.log('[Render Start] Projects table is empty; seeding default catalog...');
        const seedProjects = JSON.parse(await readFile(new URL('./seed-projects.json', import.meta.url), 'utf8'));
        for (const project of seedProjects) {
          const row = {
            id: project.id,
            slug: project.slug,
            title: project.title,
            address: project.address,
            card_address: project.cardAddress,
            price: project.price,
            remaining_units: project.remainingUnits,
            short_description: project.shortDescription,
            full_description: project.fullDescription,
            intro_title: project.introTitle,
            categories: project.categories,
            status: project.status,
            sort_order: project.sortOrder,
            cover_url: project.coverUrl,
            cover_focal_x: project.coverFocalX,
            cover_focal_y: project.coverFocalY,
            image_variants: project.imageVariants ?? { version: 1, images: {} },
            hero_type: project.heroType,
            hero_variant: project.heroVariant,
            hero_sound_enabled: project.heroSoundEnabled,
            hero_idle_ui: project.heroIdleUi,
            hero_url: project.heroUrl,
            hero_mobile_url: project.heroMobileUrl ?? null,
            hero_poster_url: project.heroPosterUrl,
            hero_videos: project.heroVideos,
            walkthrough_video_enabled: project.walkthroughVideoEnabled,
            walkthrough_video_title: project.walkthroughVideoTitle,
            walkthrough_video_desktop_url: project.walkthroughVideoDesktopUrl,
            walkthrough_video_mobile_url: project.walkthroughVideoMobileUrl,
            walkthrough_video_poster_url: project.walkthroughVideoPosterUrl,
            walkthrough_videos: project.walkthroughVideos,
            hero_focal_x: project.heroFocalX,
            hero_focal_y: project.heroFocalY,
            intro_image_url: project.introImageUrl,
            brochure_url: project.brochureUrl,
            map_query: project.mapQuery,
            map_url: project.mapUrl,
            characteristics: project.characteristics,
            benefits: project.benefits,
            floor_plan_groups: project.floorPlanGroups,
            nearby_places: project.nearbyPlaces,
            seo_title: project.seoTitle || `${project.title} - MIRACON`,
            seo_description: project.seoDescription || project.shortDescription,
            translations: project.translations ?? {},
          };
          const images = [...project.cardImages, ...project.gallery].map((image, index) => ({
            id: image.id,
            url: image.url,
            storage_path: image.storagePath ?? null,
            alt: image.alt,
            role: image.role,
            sort_order: image.sortOrder ?? index,
            width: image.width ?? null,
            height: image.height ?? null,
            focal_x: image.focalX ?? 50,
            focal_y: image.focalY ?? 50,
          }));
          await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [
            JSON.stringify(row),
            JSON.stringify(images),
          ]);
        }

        // Create baseline revisions & heads
        await client.query(`
          insert into miracon.content_revisions (
            id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_at, approved_at
          )
          select
            md5('miracon:baseline:project:' || project.id)::uuid,
            'project'::miracon.content_aggregate_type,
            project.id,
            1,
            'approved'::miracon.content_revision_state,
            'baseline'::miracon.content_revision_action,
            jsonb_build_object(
              'aggregateType', 'project',
              'aggregateId', project.id,
              'deleted', false,
              'project', to_jsonb(project),
              'images', coalesce((
                select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id)
                from miracon.project_images as image
                where image.project_id = project.id
              ), '[]'::jsonb)
            ),
            project.updated_at,
            project.updated_at
          from miracon.projects as project
          on conflict (id) do nothing;

          insert into miracon.content_revision_heads (
            aggregate_type, aggregate_id, current_revision_id, current_revision_number
          )
          select aggregate_type, aggregate_id, id, revision_number
          from miracon.content_revisions
          where action = 'baseline' and aggregate_type = 'project'
          on conflict (aggregate_type, aggregate_id) do nothing;
        `);
        console.log(`[Render Start] Seeded ${seedProjects.length} default projects with revision baselines.`);
      }
    } finally {
      await client.end();
    }
  } else {
    console.warn('[Render Start] DATABASE_URL is not defined; skipping migrations and seeds');
  }

  // 3. Launch Astro Standalone Server
  console.log(`[Render Start] Launching Astro standalone server on ${process.env.HOST}:${process.env.PORT}...`);
  const server = spawn(process.execPath, ['./dist/server/entry.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  server.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  process.on('SIGTERM', () => server.kill('SIGTERM'));
  process.on('SIGINT', () => server.kill('SIGINT'));
}

main().catch((error) => {
  console.error('[Render Start] Fatal startup error:', error);
  process.exit(1);
});
