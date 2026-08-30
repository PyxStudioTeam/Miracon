import { PostgresImportError } from './import-preparation.mjs';
import { canonicalJson } from './transfer-contract.mjs';

function projectImages(prepared, projectId) {
  return prepared.projectImages.filter((image) => image.project_id === projectId);
}

async function restoreProjectTimestamps(client, project, images) {
  await client.query(`update miracon.projects set created_at=$2, updated_at=$3, published_at=$4, translations=$5::jsonb,
    hero_mobile_url=$6, hero_poster_url=$7, walkthrough_video_title=$8,
    walkthrough_video_mobile_url=$9, walkthrough_video_poster_url=$10, brochure_url=$11 where id=$1`,
  [project.id, project.created_at, project.updated_at, project.published_at, JSON.stringify(project.translations), project.hero_mobile_url,
    project.hero_poster_url, project.walkthrough_video_title, project.walkthrough_video_mobile_url, project.walkthrough_video_poster_url, project.brochure_url]);
  for (const image of images) await client.query('update miracon.project_images set created_at=$2, storage_path=$3 where id=$1', [image.id, image.created_at, image.storage_path]);
}

async function writeImport(client, prepared) {
  for (const media of prepared.mediaFiles) {
    await client.query(`insert into miracon.media_files
      (id, relative_url, relative_path, original_name, mime_type, size_bytes, sha256, metadata, uploaded_by)
      values ($1,$2,$3,$4,$5,$6,decode($7,'hex'),$8::jsonb,null)
      on conflict (id) do update set relative_url=excluded.relative_url, relative_path=excluded.relative_path,
      original_name=excluded.original_name, mime_type=excluded.mime_type, size_bytes=excluded.size_bytes,
      sha256=excluded.sha256, metadata=excluded.metadata, uploaded_by=null
      where (media_files.relative_url,media_files.relative_path,media_files.original_name,media_files.mime_type,
        media_files.size_bytes,media_files.sha256,media_files.metadata,media_files.uploaded_by)
        is distinct from (excluded.relative_url,excluded.relative_path,excluded.original_name,excluded.mime_type,
        excluded.size_bytes,excluded.sha256,excluded.metadata,excluded.uploaded_by)`,
    [media.id, media.relative_url, media.relative_path, media.original_name, media.mime_type, media.size_bytes, media.sha256, JSON.stringify(media.metadata)]);
  }
  for (const project of prepared.projects) {
    const images = projectImages(prepared, project.id);
    await client.query('select miracon.save_project_with_images($1::jsonb,$2::jsonb)', [JSON.stringify(project), JSON.stringify(images)]);
    await client.query('alter table miracon.projects disable trigger projects_set_timestamps');
    await restoreProjectTimestamps(client, project, images);
    await client.query('alter table miracon.projects enable trigger projects_set_timestamps');
  }
  await client.query('select miracon.replace_homepage_videos($1::jsonb)', [JSON.stringify(prepared.homepageVideos)]);
  await client.query('alter table miracon.homepage_videos disable trigger homepage_videos_set_updated_at');
  for (const video of prepared.homepageVideos) {
    await client.query(`update miracon.homepage_videos set created_at=$2, updated_at=$3, project_id=$4,
      desktop_storage_path=$5, mobile_url=$6, mobile_storage_path=$7 where id=$1`,
    [video.id, video.created_at, video.updated_at, video.project_id, video.desktop_storage_path, video.mobile_url, video.mobile_storage_path]);
  }
  await client.query('alter table miracon.homepage_videos enable trigger homepage_videos_set_updated_at');
  const settings = prepared.siteSettings;
  const result = await client.query(`update miracon.site_settings set footer_terms_visible=$1, footer_terms_pdf_url=$2,
    footer_privacy_visible=$3, footer_privacy_pdf_url=$4, footer_cookie_visible=$5, footer_cookie_pdf_url=$6 where id=1`,
  [settings.footer_terms_visible, settings.footer_terms_pdf_url, settings.footer_privacy_visible, settings.footer_privacy_pdf_url, settings.footer_cookie_visible, settings.footer_cookie_pdf_url]);
  if (result.rowCount !== 1) throw new PostgresImportError('Site settings singleton update failed');
}

export async function importPreparedSnapshot(database, prepared) {
  const client = Number.isInteger(database.totalCount) ? await database.connect() : database;
  const release = client !== database && typeof client.release === 'function';
  try {
    await client.query('begin');
    try {
      const ledger = await client.query('select filename, checksum as sha256 from miracon_meta.schema_migrations order by filename');
      if (canonicalJson(ledger.rows) !== canonicalJson(prepared.targetMigrations)) {
        throw new PostgresImportError('Applied target migration filename/checksum set does not match snapshot');
      }
      await writeImport(client, prepared);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    if (release) client.release();
  }
  return { snapshotId: prepared.snapshotId, counts: prepared.counts, written: true };
}
