import { OMITTED_OBJECTS, TransferContractError, canonicalJson } from './transfer-contract.mjs';

const PROJECT_FIELDS = [
  'id', 'slug', 'title', 'address', 'card_address', 'price', 'short_description',
  'full_description', 'intro_title', 'categories', 'status', 'sort_order', 'cover_url',
  'cover_focal_x', 'cover_focal_y', 'image_variants', 'hero_type', 'hero_variant',
  'hero_sound_enabled', 'hero_idle_ui', 'hero_url', 'hero_mobile_url', 'hero_poster_url',
  'hero_videos', 'walkthrough_video_enabled', 'walkthrough_video_title',
  'walkthrough_video_desktop_url', 'walkthrough_video_mobile_url',
  'walkthrough_video_poster_url', 'walkthrough_videos', 'hero_focal_x', 'hero_focal_y',
  'intro_image_url', 'brochure_url', 'map_query', 'map_url', 'characteristics', 'benefits',
  'floor_plan_groups', 'nearby_places', 'translations', 'seo_title', 'seo_description',
  'published_at', 'created_at', 'updated_at', 'remaining_units',
];
const IMAGE_FIELDS = ['id', 'project_id', 'url', 'storage_path', 'alt', 'role', 'sort_order', 'width', 'height', 'focal_x', 'focal_y', 'created_at'];
const HOME_FIELDS = ['id', 'title', 'project_id', 'desktop_url', 'desktop_storage_path', 'mobile_url', 'mobile_storage_path', 'sort_order', 'is_active', 'created_at', 'updated_at'];
const SETTINGS_FIELDS = ['id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible', 'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url'];
const SCALAR_MEDIA_FIELDS = ['cover_url', 'hero_url', 'hero_mobile_url', 'hero_poster_url', 'walkthrough_video_desktop_url', 'walkthrough_video_mobile_url', 'walkthrough_video_poster_url', 'intro_image_url', 'brochure_url'];

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TransferContractError(path, 'object is required');
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TransferContractError(path, 'non-empty string is required');
  return value;
}

function rows(value, path) {
  if (!Array.isArray(value)) throw new TransferContractError(path, 'array is required');
  return value;
}

function validateFields(row, path, fields, predicate, expected) {
  for (const field of fields) if (!predicate(row[field])) throw new TransferContractError(`${path}.${field}`, expected);
}

const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value === null || typeof value === 'string';
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value) => value === null || isFiniteNumber(value);
const isNullableNonnegativeInteger = (value) => value === null || (Number.isInteger(value) && value >= 0);
const isBoolean = (value) => typeof value === 'boolean';

function projectRow(value, index) {
  const path = `$.projects[${index}]`;
  const row = record(value, path);
  for (const field of PROJECT_FIELDS) if (!(field in row)) throw new TransferContractError(`${path}.${field}`, 'field is required');
  nonEmptyString(row.id, `${path}.id`); nonEmptyString(row.slug, `${path}.slug`); nonEmptyString(row.title, `${path}.title`);
  validateFields(row, path, ['address', 'card_address', 'price', 'short_description', 'full_description', 'intro_title', 'cover_url', 'hero_type', 'hero_variant', 'hero_url', 'walkthrough_video_title', 'walkthrough_video_desktop_url', 'intro_image_url', 'map_query', 'map_url', 'seo_title', 'seo_description', 'created_at', 'updated_at'], isString, 'string is required');
  validateFields(row, path, ['hero_mobile_url', 'hero_poster_url', 'walkthrough_video_mobile_url', 'walkthrough_video_poster_url', 'brochure_url', 'published_at'], isNullableString, 'string or null is required');
  validateFields(row, path, ['sort_order', 'cover_focal_x', 'cover_focal_y', 'hero_focal_x', 'hero_focal_y'], isFiniteNumber, 'finite number is required');
  validateFields(row, path, ['remaining_units'], isNullableNonnegativeInteger, 'nonnegative integer or null is required');
  validateFields(row, path, ['hero_sound_enabled', 'hero_idle_ui', 'walkthrough_video_enabled'], isBoolean, 'boolean is required');
  if (!['draft', 'published'].includes(row.status)) throw new TransferContractError(`${path}.status`, 'invalid project status');
  for (const field of ['categories', 'hero_videos', 'walkthrough_videos', 'characteristics', 'benefits', 'floor_plan_groups', 'nearby_places']) rows(row[field], `${path}.${field}`);
  record(row.image_variants, `${path}.image_variants`); record(row.translations, `${path}.translations`);
  return Object.fromEntries(PROJECT_FIELDS.map((field) => [field, row[field]]));
}

function pickedRow(value, fields, path) {
  const row = record(value, path);
  for (const field of fields) if (!(field in row)) throw new TransferContractError(`${path}.${field}`, 'field is required');
  nonEmptyString(row.id, `${path}.id`);
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function imageRow(value, index) {
  const path = `$.projectImages[${index}]`;
  const row = pickedRow(value, IMAGE_FIELDS, path);
  nonEmptyString(row.project_id, `${path}.project_id`); nonEmptyString(row.url, `${path}.url`);
  validateFields(row, path, ['alt', 'role', 'created_at'], isString, 'string is required');
  validateFields(row, path, ['storage_path'], isNullableString, 'string or null is required');
  validateFields(row, path, ['sort_order', 'focal_x', 'focal_y'], isFiniteNumber, 'finite number is required');
  validateFields(row, path, ['width', 'height'], isNullableNumber, 'finite number or null is required');
  if (!['card', 'gallery'].includes(row.role)) throw new TransferContractError(`${path}.role`, 'invalid image role');
  return row;
}

function homepageRow(value, index) {
  const path = `$.homepageVideos[${index}]`;
  const row = pickedRow(value, HOME_FIELDS, path);
  validateFields(row, path, ['title', 'desktop_url', 'created_at', 'updated_at'], isString, 'string is required');
  validateFields(row, path, ['project_id', 'desktop_storage_path', 'mobile_url', 'mobile_storage_path'], isNullableString, 'string or null is required');
  validateFields(row, path, ['sort_order'], isFiniteNumber, 'finite number is required');
  validateFields(row, path, ['is_active'], isBoolean, 'boolean is required');
  return row;
}

function ensureUnique(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TransferContractError(`$.${label}`, `duplicate ${label.replace(/s$/, '')} id ${row.id}`);
    ids.add(row.id);
  }
}

function decodedSegments(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) throw new TransferContractError('$.url', 'Supabase storage URL has invalid encoding');
    throw error;
  }
  if (decoded.includes('\\')) throw new TransferContractError('$.url', 'Supabase storage path contains a backslash');
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new TransferContractError('$.url', 'Supabase storage path contains traversal');
  return segments;
}

export function classifyMediaUrl(value, context) {
  const originalUrl = nonEmptyString(value, '$.url');
  if (originalUrl.startsWith('/')) return { classification: originalUrl.startsWith('/media/') ? 'same-domain-media' : 'local-static' };
  let parsed;
  try {
    parsed = new URL(originalUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new TransferContractError('$.url', 'absolute URL or root-relative path is required');
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TransferContractError('$.url', 'safe HTTP(S) URL is required');
  const sourceHost = nonEmptyString(context.sourceIdentifier, '$.sourceIdentifier').toLowerCase();
  const storagePrefix = '/storage/v1/object/public/';
  if (parsed.host.toLowerCase() === sourceHost && parsed.pathname.startsWith(storagePrefix)) {
    const authorityEnd = originalUrl.indexOf(parsed.host) + parsed.host.length;
    const rawPathname = originalUrl.slice(authorityEnd).split(/[?#]/, 1)[0];
    const remainder = rawPathname.slice(storagePrefix.length);
    const segments = decodedSegments(`/${remainder}`).slice(1);
    const [bucket, ...pathSegments] = segments;
    if (!bucket || pathSegments.length === 0 || pathSegments.some((segment) => segment === '')) {
      throw new TransferContractError('$.url', 'Supabase storage bucket and path are required');
    }
    return { classification: 'supabase-storage', bucket, objectPath: pathSegments.join('/') };
  }
  const sameDomain = context.siteOrigins.some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin;
    } catch (error) {
      if (error instanceof TypeError) throw new TransferContractError('$.siteOrigins', 'valid origins are required');
      throw error;
    }
  });
  return { classification: sameDomain && parsed.pathname.startsWith('/media/') ? 'same-domain-media' : 'external' };
}

function addReference(references, context, sourceTable, sourceId, key, url, storagePath = null) {
  if (url === null || url === '') return;
  const classified = classifyMediaUrl(url, context);
  references.push({ sourceTable, sourceId, key, originalUrl: url, storagePath, ...classified, transferCandidate: classified.classification === 'supabase-storage' });
}

function addPlaylistReferences(references, context, project, field) {
  const ids = new Set();
  for (const [index, video] of project[field].entries()) {
    const item = record(video, `$.projects.${project.id}.${field}[${index}]`);
    const id = nonEmptyString(item.id, `$.projects.${project.id}.${field}[${index}].id`);
    if (ids.has(id)) throw new TransferContractError(`$.projects.${project.id}.${field}`, `duplicate stable id ${id}`);
    ids.add(id);
    validateFields(item, `$.projects.${project.id}.${field}[${index}]`, ['desktopUrl'], isString, 'string is required');
    validateFields(item, `$.projects.${project.id}.${field}[${index}]`, ['mobileUrl', 'posterUrl'], isNullableString, 'string or null is required');
    for (const key of ['desktopUrl', 'mobileUrl', 'posterUrl']) addReference(references, context, 'projects', project.id, `${field}.${index}.${key}`, item[key]);
  }
}

function addNestedReferences(references, context, project) {
  const images = record(project.image_variants, `$.projects.${project.id}.image_variants`).images;
  for (const [sourceUrl, variantSet] of Object.entries(record(images, `$.projects.${project.id}.image_variants.images`))) {
    addReference(references, context, 'projects', project.id, `image_variants.images.${sourceUrl}.source`, sourceUrl);
    for (const format of ['avif', 'webp']) for (const [index, candidate] of (variantSet[format] ?? []).entries()) {
      addReference(references, context, 'projects', project.id, `image_variants.images.${sourceUrl}.${format}.${index}.src`, candidate.src);
    }
  }
  for (const [index, benefit] of project.benefits.entries()) addReference(references, context, 'projects', project.id, `benefits.${index}.icon`, benefit.icon);
  for (const [groupIndex, group] of project.floor_plan_groups.entries()) for (const [planIndex, plan] of group.plans.entries()) {
    addReference(references, context, 'projects', project.id, `floor_plan_groups.${groupIndex}.plans.${planIndex}.imageUrl`, plan.imageUrl);
  }
}

export function transformSupabaseSnapshot(input) {
  const boundary = record(input, '$');
  const sourceIdentifier = nonEmptyString(boundary.sourceIdentifier, '$.sourceIdentifier');
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(sourceIdentifier)) throw new TransferContractError('$.sourceIdentifier', 'non-secret source hostname is required');
  const siteOrigins = [...rows(boundary.siteOrigins, '$.siteOrigins')];
  const context = { sourceIdentifier, siteOrigins };
  const projects = rows(boundary.projects, '$.projects').map(projectRow).sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const projectImages = rows(boundary.projectImages, '$.projectImages').map(imageRow).sort((left, right) => left.project_id.localeCompare(right.project_id) || left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const homepageVideos = rows(boundary.homepageVideos, '$.homepageVideos').map(homepageRow).sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  ensureUnique(projects, 'projects'); ensureUnique(projectImages, 'projectImages'); ensureUnique(homepageVideos, 'homepageVideos');
  const settingsRow = record(boundary.siteSettings, '$.siteSettings');
  for (const field of SETTINGS_FIELDS) if (!(field in settingsRow)) throw new TransferContractError(`$.siteSettings.${field}`, 'field is required');
  const siteSettings = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, settingsRow[field]]));
  if (siteSettings.id !== 1) throw new TransferContractError('$.siteSettings.id', 'singleton id 1 is required');
  validateFields(siteSettings, '$.siteSettings', SETTINGS_FIELDS.filter((field) => field.endsWith('_visible')), isBoolean, 'boolean is required');
  validateFields(siteSettings, '$.siteSettings', SETTINGS_FIELDS.filter((field) => field.endsWith('_url')), isString, 'string is required');
  const mediaReferences = [];
  for (const project of projects) {
    for (const field of SCALAR_MEDIA_FIELDS) addReference(mediaReferences, context, 'projects', project.id, field, project[field]);
    addPlaylistReferences(mediaReferences, context, project, 'hero_videos');
    addPlaylistReferences(mediaReferences, context, project, 'walkthrough_videos');
    addNestedReferences(mediaReferences, context, project);
  }
  for (const image of projectImages) addReference(mediaReferences, context, 'project_images', image.id, 'url', image.url, image.storage_path);
  for (const video of homepageVideos) {
    addReference(mediaReferences, context, 'homepage_videos', video.id, 'desktop_url', video.desktop_url, video.desktop_storage_path);
    addReference(mediaReferences, context, 'homepage_videos', video.id, 'mobile_url', video.mobile_url, video.mobile_storage_path);
  }
  for (const field of SETTINGS_FIELDS.filter((field) => field.endsWith('_url'))) addReference(mediaReferences, context, 'site_settings', '1', field, siteSettings[field]);
  mediaReferences.sort((left, right) => `${left.sourceTable}\0${left.sourceId}\0${left.key}\0${left.originalUrl}`.localeCompare(`${right.sourceTable}\0${right.sourceId}\0${right.key}\0${right.originalUrl}`));
  const targetMigrations = rows(boundary.targetMigrations, '$.targetMigrations').map((value, index) => {
    const migration = record(value, `$.targetMigrations[${index}]`);
    const filename = nonEmptyString(migration.filename, `$.targetMigrations[${index}].filename`);
    if (typeof migration.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(migration.sha256)) throw new TransferContractError(`$.targetMigrations[${index}].sha256`, 'lowercase SHA-256 is required');
    return { filename, sha256: migration.sha256 };
  }).sort((left, right) => left.filename.localeCompare(right.filename));
  const content = {
    sourceIdentifier, targetMigrations, projects, projectImages, homepageVideos, siteSettings,
    mediaReferences, omittedObjects: OMITTED_OBJECTS, urlRewriteMap: {},
    counts: { projects: projects.length, projectImages: projectImages.length, homepageVideos: homepageVideos.length, siteSettings: 1, mediaReferences: mediaReferences.length, transferCandidates: mediaReferences.filter((item) => item.transferCandidate).length },
  };
  canonicalJson(content);
  return content;
}
