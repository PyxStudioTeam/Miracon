import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePostgresImport } from '../scripts/migration/postgres-import.mjs';
import { buildParityReport } from '../scripts/migration/parity-report.mjs';
import { importFixture } from './fixtures.mjs';

test('classifies missing, changed, and unrelated informational extras separately', async () => {
  const prepared = preparePostgresImport(await importFixture());
  const target = {
    projects: structuredClone(prepared.projects), projectImages: [], homepageVideos: structuredClone(prepared.homepageVideos),
    siteSettings: [structuredClone(prepared.siteSettings)], mediaFiles: structuredClone(prepared.mediaFiles),
  };
  target.projects[0].title = 'Changed';
  target.projects.push({ id: 'unrelated-project' });

  const report = buildParityReport(prepared, target);

  assert.equal(report.valid, false);
  assert.deepEqual(report.mismatches.missing.map((item) => item.scope), ['projectImages']);
  assert.deepEqual(report.mismatches.changed.map(({ scope, id }) => ({ scope, id })), [{ scope: 'projects', id: 'project-1' }]);
  assert.deepEqual(report.informational.extra, [{ scope: 'projects', id: 'unrelated-project' }]);
});

test('fails strict parity for extra projects, images, and media while preserving non-strict reporting', async () => {
  // Given
  const prepared = preparePostgresImport(await importFixture());
  const target = {
    projects: [...structuredClone(prepared.projects), { id: 'extra-project' }],
    projectImages: [...structuredClone(prepared.projectImages), { id: 'extra-image' }],
    homepageVideos: structuredClone(prepared.homepageVideos),
    siteSettings: [structuredClone(prepared.siteSettings)],
    mediaFiles: [...structuredClone(prepared.mediaFiles), { id: 'extra-media' }],
  };

  // When
  const ordinary = buildParityReport(prepared, target);
  const strict = buildParityReport(prepared, target, { strict: true });

  // Then
  assert.equal(ordinary.valid, true);
  assert.equal(strict.valid, false);
  assert.deepEqual(strict.mismatches.extra.map(({ scope }) => scope), ['projects', 'projectImages', 'mediaFiles']);
});

test('reports remaining-unit drift between zero and null', async () => {
  // Given
  const prepared = preparePostgresImport(await importFixture());
  const target = {
    projects: structuredClone(prepared.projects), projectImages: structuredClone(prepared.projectImages),
    homepageVideos: structuredClone(prepared.homepageVideos), siteSettings: [structuredClone(prepared.siteSettings)],
    mediaFiles: structuredClone(prepared.mediaFiles),
  };
  target.projects[0].remaining_units = null;

  // When
  const report = buildParityReport(prepared, target);

  // Then
  assert.deepEqual(report.mismatches.changed.map(({ scope, id }) => ({ scope, id })), [{ scope: 'projects', id: 'project-1' }]);
});
