import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseMediaTransferArguments, runMediaTransferCli } from '../scripts/supabase-media-transfer.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('cli png')]);
const ORIGINAL_URL = 'https://private-project.supabase.co/storage/v1/object/public/project-media/gallery/hero.png?token=private';

function snapshot() {
  return {
    version: 'miracon-phase4-transfer/v1',
    snapshotId: 'snapshot-cli-test',
    contentHash: 'd'.repeat(64),
    content: { mediaReferences: [{ classification: 'supabase-storage', transferCandidate: true, bucket: 'project-media', objectPath: 'gallery/hero.png', originalUrl: ORIGINAL_URL }] },
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'input');
  const mediaRoot = join(root, 'media');
  const statePath = join(root, 'state', 'transfer.json');
  await mkdir(input);
  await mkdir(mediaRoot);
  await writeFile(join(input, 'snapshot.json'), JSON.stringify(snapshot()));
  return { input, mediaRoot, statePath };
}

function argumentsFor(paths, flags = []) {
  return [`--input=${paths.input}`, `--media-root=${paths.mediaRoot}`, `--state=${paths.statePath}`, ...flags];
}

function clientFactory(calls) {
  return (sourceUrl, serviceRoleKey) => {
    calls.push({ operation: 'client', sourceUrl, serviceRoleKey });
    return {
      storage: {
        from(bucket) {
          calls.push({ operation: 'from', bucket });
          return { download: async (objectPath) => {
            calls.push({ operation: 'download', objectPath });
            return { data: new Blob([PNG], { type: 'image/png' }), error: null };
          } };
        },
      },
    };
  };
}

test('transfers verified media locally and returns only a redacted JSON-safe summary', async (t) => {
  // Given
  const paths = await fixture(t);
  const calls = [];
  const environment = { SUPABASE_SOURCE_URL: 'https://source-project.supabase.co', SUPABASE_SOURCE_SERVICE_ROLE_KEY: 'service-role-secret' };

  // When
  const result = await runMediaTransferCli(argumentsFor(paths), environment, { createSourceClient: clientFactory(calls) });
  const output = JSON.stringify(result);
  const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
  const transferred = await readFile(state.records[0].absolutePath);

  // Then
  assert.equal(createHash('sha256').update(transferred).digest('hex'), createHash('sha256').update(PNG).digest('hex'));
  assert.deepEqual(calls.slice(1), [{ operation: 'from', bucket: 'project-media' }, { operation: 'download', objectPath: 'gallery/hero.png' }]);
  assert.deepEqual(result, { snapshotId: 'snapshot-cli-test', dryRun: false, resume: false, candidates: 1, completed: 1, pending: 0, urlRewrites: 1 });
  assert.doesNotMatch(output, /service-role-secret|source-project|private-project|token=|absolutePath|objectPath/iu);
});

test('resume reuses verified state without a second Storage call', async (t) => {
  // Given
  const paths = await fixture(t);
  const calls = [];
  const environment = { SUPABASE_SOURCE_URL: 'https://source-project.supabase.co', SUPABASE_SOURCE_SERVICE_ROLE_KEY: 'secret' };
  const dependencies = { createSourceClient: clientFactory(calls) };
  await runMediaTransferCli(argumentsFor(paths, ['--resume']), environment, dependencies);

  // When
  const result = await runMediaTransferCli(argumentsFor(paths, ['--resume']), environment, dependencies);

  // Then
  assert.equal(calls.filter(({ operation }) => operation === 'download').length, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.resume, true);
});

test('dry run needs no credentials, creates no client, and writes no state', async (t) => {
  // Given
  const paths = await fixture(t);
  let clientCalls = 0;

  // When
  const result = await runMediaTransferCli(argumentsFor(paths, ['--dry-run']), {}, { createSourceClient() { clientCalls += 1; throw new Error('must not instantiate'); } });

  // Then
  assert.equal(clientCalls, 0);
  assert.deepEqual(result, { snapshotId: 'snapshot-cli-test', dryRun: true, resume: false, candidates: 1, completed: 0, pending: 1, urlRewrites: 0 });
  await assert.rejects(access(paths.statePath), { code: 'ENOENT' });
});

test('parses required paths and rejects relative media or state paths', () => {
  // Given
  const absolute = process.platform === 'win32' ? 'C:\\migration' : '/migration';

  // When / Then
  assert.deepEqual(parseMediaTransferArguments([`--input=${absolute}`, `--media-root=${absolute}`, `--state=${join(absolute, 'state.json')}`, '--dry-run', '--resume']), {
    input: absolute, mediaRoot: absolute, statePath: join(absolute, 'state.json'), dryRun: true, resume: true,
  });
  assert.throws(() => parseMediaTransferArguments(['--input=input', '--media-root=media', '--state=state.json']), /absolute/i);
});
