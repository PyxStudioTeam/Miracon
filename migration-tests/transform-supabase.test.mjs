import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceRows } from './fixtures.mjs';
import { classifyMediaUrl, transformSupabaseSnapshot } from '../scripts/migration/transform-supabase.mjs';

test('preserves all supported project, translation, image, homepage, and settings fields', () => {
  const result = transformSupabaseSnapshot(sourceRows);
  const project = result.projects[0];
  assert.deepEqual(project, sourceRows.projects[0]);
  assert.deepEqual(result.projectImages[0], sourceRows.projectImages[0]);
  assert.deepEqual(result.homepageVideos[0], sourceRows.homepageVideos[0]);
  assert.deepEqual(result.siteSettings, sourceRows.siteSettings);
  assert.equal(project.translations.el.title, 'Κατοικία Αιγαίου');
  assert.equal(project.remaining_units, 0);
});

test('requires nullable nonnegative integer project availability', () => {
  // Given
  const negative = structuredClone(sourceRows);
  negative.projects[0].remaining_units = -1;
  const fractional = structuredClone(sourceRows);
  fractional.projects[0].remaining_units = 1.5;
  const missing = structuredClone(sourceRows);
  delete missing.projects[0].remaining_units;
  const nullable = structuredClone(sourceRows);
  nullable.projects[0].remaining_units = null;

  // When / Then
  assert.equal(transformSupabaseSnapshot(nullable).projects[0].remaining_units, null);
  assert.throws(() => transformSupabaseSnapshot(negative), /remaining_units/u);
  assert.throws(() => transformSupabaseSnapshot(fractional), /remaining_units/u);
  assert.throws(() => transformSupabaseSnapshot(missing), /remaining_units/u);
});

test('discovers playlists, variants, benefits, floor plans, images, homepage, and settings documents', () => {
  const references = transformSupabaseSnapshot(sourceRows).mediaReferences;
  const keys = new Set(references.map((reference) => `${reference.sourceTable}:${reference.key}`));
  for (const expected of [
    'projects:hero_videos.0.desktopUrl',
    'projects:walkthrough_videos.0.mobileUrl',
    'projects:image_variants.images./img/cover.webp.avif.0.src',
    'projects:benefits.0.icon',
    'projects:floor_plan_groups.0.plans.0.imageUrl',
    'project_images:url',
    'homepage_videos:desktop_url',
    'site_settings:footer_terms_pdf_url',
  ]) assert.ok(keys.has(expected), expected);
});

test('classifies local, storage, external, and same-domain media deterministically', () => {
  const context = { sourceIdentifier: sourceRows.sourceIdentifier, siteOrigins: sourceRows.siteOrigins };
  assert.equal(classifyMediaUrl('/img/a.webp', context).classification, 'local-static');
  assert.equal(classifyMediaUrl('/media/a.webp', context).classification, 'same-domain-media');
  assert.equal(classifyMediaUrl('https://cdn.example.test/a.webp', context).classification, 'external');
  assert.equal(classifyMediaUrl('https://www.example.test/media/a.webp', context).classification, 'same-domain-media');
  assert.deepEqual(classifyMediaUrl('https://fake-project.supabase.co/storage/v1/object/public/project-media/folder/a.webp', context), {
    classification: 'supabase-storage', bucket: 'project-media', objectPath: 'folder/a.webp',
  });
});

test('rejects unsafe Supabase public object paths', () => {
  const context = { sourceIdentifier: sourceRows.sourceIdentifier, siteOrigins: [] };
  for (const url of [
    'https://fake-project.supabase.co/storage/v1/object/public//file.webp',
    'https://fake-project.supabase.co/storage/v1/object/public/project-media/',
    'https://fake-project.supabase.co/storage/v1/object/public/project-media/../secret',
    'https://fake-project.supabase.co/storage/v1/object/public/project-media/folder/../secret',
    'https://fake-project.supabase.co/storage/v1/object/public/project-media/folder%2F..%2Fsecret',
    'https://fake-project.supabase.co/storage/v1/object/public/project-media/folder%5Csecret',
  ]) assert.throws(() => classifyMediaUrl(url, context), /storage/i);
});
