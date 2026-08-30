import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildParityReport } from './parity-report.mjs';

async function readTarget(database, prepared) {
  const mediaIds = prepared.mediaFiles.map((media) => media.id);
  const projects = await database.query('select * from miracon.projects order by id');
  const projectImages = await database.query('select * from miracon.project_images order by id');
  const homepageVideos = await database.query('select * from miracon.homepage_videos order by sort_order, id');
  const siteSettings = await database.query('select * from miracon.site_settings where id = 1');
  const mediaFiles = await database.query('select *, encode(sha256,\'hex\') as sha256 from miracon.media_files where id = any($1::text[]) order by id', [mediaIds]);
  const allMedia = await database.query('select id from miracon.media_files where not (id = any($1::text[])) order by id', [mediaIds]);
  return {
    projects: projects.rows, projectImages: projectImages.rows, homepageVideos: homepageVideos.rows,
    siteSettings: siteSettings.rows, mediaFiles: [...mediaFiles.rows, ...allMedia.rows],
  };
}

export async function validateTransfer({ database, prepared, strict = false }) {
  if (!database) throw new TypeError('An explicit PostgreSQL Pool or connection is required');
  return buildParityReport(prepared, await readTarget(database, prepared), { strict });
}

export function validationArguments(argumentsList) {
  return [...argumentsList, '--validate', '--strict'];
}

async function main() {
  const { runImportCli } = await import('../supabase-import.mjs');
  const result = await runImportCli(validationArguments(process.argv.slice(2)), process.env);
  console.log(JSON.stringify(result));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Transfer validation failed');
    process.exitCode = 1;
  });
}
