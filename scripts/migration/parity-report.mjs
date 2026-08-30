import { canonicalJson } from './transfer-contract.mjs';

const PROJECT_FIELDS = [
  'id','slug','title','address','card_address','price','short_description','full_description','intro_title','categories','status','sort_order','cover_url','cover_focal_x','cover_focal_y','image_variants','hero_type','hero_variant','hero_sound_enabled','hero_idle_ui','hero_url','hero_mobile_url','hero_poster_url','hero_videos','walkthrough_video_enabled','walkthrough_video_title','walkthrough_video_desktop_url','walkthrough_video_mobile_url','walkthrough_video_poster_url','walkthrough_videos','hero_focal_x','hero_focal_y','intro_image_url','brochure_url','map_query','map_url','characteristics','benefits','floor_plan_groups','nearby_places','translations','seo_title','seo_description','published_at','created_at','updated_at','remaining_units',
];
const IMAGE_FIELDS = ['id','project_id','url','storage_path','alt','role','sort_order','width','height','focal_x','focal_y','created_at'];
const HOME_FIELDS = ['id','title','project_id','desktop_url','desktop_storage_path','mobile_url','mobile_storage_path','sort_order','is_active','created_at','updated_at'];
const SETTINGS_FIELDS = ['id','footer_terms_visible','footer_terms_pdf_url','footer_privacy_visible','footer_privacy_pdf_url','footer_cookie_visible','footer_cookie_pdf_url'];
const MEDIA_FIELDS = ['id','relative_url','relative_path','original_name','mime_type','size_bytes','sha256','metadata','uploaded_by'];
const NUMERIC_FIELDS = new Set(['sort_order','cover_focal_x','cover_focal_y','hero_focal_x','hero_focal_y','focal_x','focal_y','width','height','size_bytes','remaining_units']);

function normalized(value, key) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value === null || typeof value !== 'object') return NUMERIC_FIELDS.has(key) && value !== null ? Number(value) : value;
  if (Array.isArray(value)) return value.map((item) => normalized(item, key));
  return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, normalized(item, childKey)]));
}

function pick(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, normalized(row[field], field)]));
}

function compareRows(scope, expectedRows, actualRows, fields, extraFails) {
  const expected = new Map(expectedRows.map((row) => [String(row.id), pick(row, fields)]));
  const actual = new Map(actualRows.map((row) => [String(row.id), pick(row, fields)]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id)).map((id) => ({ scope, id }));
  const extra = [...actual.keys()].filter((id) => !expected.has(id)).map((id) => ({ scope, id, failure: extraFails }));
  const changed = [];
  for (const [id, expectedRow] of expected) {
    const actualRow = actual.get(id);
    if (actualRow && canonicalJson(expectedRow) !== canonicalJson(actualRow)) changed.push({ scope, id, expected: expectedRow, actual: actualRow });
  }
  return { missing, extra, changed };
}

export function buildParityReport(prepared, target, { strict = false } = {}) {
  const comparisons = [
    compareRows('projects', prepared.projects, target.projects, PROJECT_FIELDS, strict),
    compareRows('projectImages', prepared.projectImages, target.projectImages, IMAGE_FIELDS, strict),
    compareRows('homepageVideos', prepared.homepageVideos, target.homepageVideos, HOME_FIELDS, true),
    compareRows('siteSettings', [prepared.siteSettings], target.siteSettings, SETTINGS_FIELDS, true),
    compareRows('mediaFiles', prepared.mediaFiles, target.mediaFiles, MEDIA_FIELDS, strict),
  ];
  const missing = comparisons.flatMap((item) => item.missing);
  const changed = comparisons.flatMap((item) => item.changed);
  const failedExtra = comparisons.flatMap((item) => item.extra.filter((entry) => entry.failure));
  const informationalExtra = comparisons.flatMap((item) => item.extra.filter((entry) => !entry.failure).map(({ failure, ...entry }) => entry));
  const extra = failedExtra.map(({ failure, ...entry }) => entry);
  const counts = Object.fromEntries(['projects','projectImages','homepageVideos','siteSettings','mediaFiles'].map((scope) => [scope, {
    expected: prepared.counts[scope], actual: target[scope].length,
  }]));
  return { snapshotId: prepared.snapshotId, contentHash: prepared.contentHash, valid: missing.length === 0 && changed.length === 0 && extra.length === 0, counts, mismatches: { missing, extra, changed }, informational: { extra: informationalExtra } };
}
