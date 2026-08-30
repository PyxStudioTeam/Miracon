import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { transferSnapshotMedia } from '../scripts/migration/media-transfer.mjs';
import { deriveMediaTarget } from '../scripts/migration/media-paths.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('verified png')]);
const SAFE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M2 12h20"/></svg>');
const CSS_ESCAPED_URL_SVG = Buffer.from(String.raw`<svg xmlns="http://www.w3.org/2000/svg">
  <path filter="u\72l(&quot;https://attacker.test/filter.svg#x&quot;)"/>
</svg>`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const storageUrl = (path) => `https://fake.supabase.co/storage/v1/object/public/project-media/${path}`;

function snapshot(references) {
  return { version: 'miracon-phase4-transfer/v1', snapshotId: 'snapshot-test', contentHash: 'b'.repeat(64), content: { mediaReferences: references } };
}

function reference(path, originalUrl = storageUrl(path), metadata = {}) {
  return { classification: 'supabase-storage', transferCandidate: true, bucket: 'project-media', objectPath: path, originalUrl, sourceTable: 'projects', sourceId: 'one', key: path, ...metadata };
}

function downloaderFor(entries, calls = []) {
  return async ({ bucket, objectPath }) => {
    calls.push(`${bucket}/${objectPath}`);
    const entry = entries[objectPath];
    if (entry instanceof Error) throw entry;
    return { stream: Readable.from(entry.bytes), mimeType: entry.mimeType, bytes: entry.declaredBytes, sha256: entry.declaredSha256 };
  };
}

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-media-transfer-'));
  const mediaRoot = join(parent, 'media');
  await mkdir(mediaRoot);
  return { parent, mediaRoot, statePath: join(parent, 'transfer-state.json') };
}

test('deduplicates objects while retaining every reference and writes verified content and state', async () => {
  // Given
  const paths = await fixture();
  const calls = [];
  const firstUrl = storageUrl('gallery/original.jpg');
  const secondUrl = `${firstUrl}?download=1`;
  const input = snapshot([reference('gallery/original.jpg', firstUrl), reference('gallery/original.jpg', secondUrl)]);
  const downloader = downloaderFor({ 'gallery/original.jpg': { bytes: PNG, mimeType: 'image/png', declaredBytes: PNG.length, declaredSha256: sha256(PNG) } }, calls);

  // When
  const result = await transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader, resume: true });

  // Then
  assert.deepEqual(calls, ['project-media/gallery/original.jpg']);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].references.length, 2);
  assert.equal(await readFile(result.candidates[0].absolutePath, 'hex'), PNG.toString('hex'));
  assert.equal(result.urlRewriteMap[firstUrl], result.candidates[0].relativeUrl);
  assert.equal(result.urlRewriteMap[secondUrl], result.candidates[0].relativeUrl);
  assert.equal(JSON.parse(await readFile(paths.statePath, 'utf8')).records[0].status, 'completed');
  assert.deepEqual((await readdir(dirname(paths.statePath))).filter((name) => name.includes('.tmp-')), []);
});

test('persists completed records across interruption and revalidates them on resume', async () => {
  // Given
  const paths = await fixture();
  const input = snapshot([reference('a.png'), reference('b.png')]);
  const firstCalls = [];
  const interrupted = downloaderFor({ 'a.png': { bytes: PNG, mimeType: 'image/png' }, 'b.png': new Error('interrupted') }, firstCalls);
  await assert.rejects(transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: interrupted, resume: true }), /interrupted/);
  const resumeCalls = [];

  // When
  const result = await transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({ 'b.png': { bytes: PNG, mimeType: 'image/png' } }, resumeCalls), resume: true });

  // Then
  assert.deepEqual(firstCalls, ['project-media/a.png', 'project-media/b.png']);
  assert.deepEqual(resumeCalls, ['project-media/b.png']);
  assert.equal(result.candidates.every((candidate) => candidate.status === 'completed'), true);
});

test('rejects invalid signatures and downloader declared size or checksum mismatches without publishing', async () => {
  // Given
  const cases = [
    { path: 'bad-signature.png', bytes: Buffer.from('not png'), mimeType: 'image/png' },
    { path: 'bad-size.png', bytes: PNG, mimeType: 'image/png', declaredBytes: PNG.length + 1 },
    { path: 'bad-hash.png', bytes: PNG, mimeType: 'image/png', declaredSha256: 'c'.repeat(64) },
  ];

  // When / Then
  for (const entry of cases) {
    const paths = await fixture();
    await assert.rejects(transferSnapshotMedia({ snapshot: snapshot([reference(entry.path)]), mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({ [entry.path]: entry }), resume: true }), /signature|size|checksum/i);
    assert.deepEqual((await readdir(paths.mediaRoot, { recursive: true })).filter((name) => name.endsWith('.part')), []);
  }
});

test('transfers passive SVG icons and rejects active SVG content without publishing', async () => {
  // Given
  const safePaths = await fixture();
  const unsafePaths = await fixture();
  const unsafeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.test/pixel"/></svg>');

  // When
  const transferred = await transferSnapshotMedia({
    snapshot: snapshot([reference('icons/beach.svg')]),
    mediaRoot: safePaths.mediaRoot,
    statePath: safePaths.statePath,
    downloader: downloaderFor({ 'icons/beach.svg': { bytes: SAFE_SVG, mimeType: 'image/svg+xml' } }),
  });

  // Then
  assert.match(transferred.candidates[0].relativePath, /\.svg$/u);
  assert.equal(await readFile(transferred.candidates[0].absolutePath, 'utf8'), SAFE_SVG.toString());
  await assert.rejects(transferSnapshotMedia({
    snapshot: snapshot([reference('icons/unsafe.svg')]),
    mediaRoot: unsafePaths.mediaRoot,
    statePath: unsafePaths.statePath,
    downloader: downloaderFor({ 'icons/unsafe.svg': { bytes: unsafeSvg, mimeType: 'image/svg+xml' } }),
  }), /signature|SVG/i);
  assert.deepEqual((await readdir(unsafePaths.mediaRoot, { recursive: true })).filter((name) => name.endsWith('.svg') || name.endsWith('.part')), []);
});

test('rejects a CSS-escaped external SVG URL without publishing', async () => {
  // Given
  const paths = await fixture();

  // When / Then
  await assert.rejects(transferSnapshotMedia({
    snapshot: snapshot([reference('icons/escaped-url.svg')]),
    mediaRoot: paths.mediaRoot,
    statePath: paths.statePath,
    downloader: downloaderFor({ 'icons/escaped-url.svg': { bytes: CSS_ESCAPED_URL_SVG, mimeType: 'image/svg+xml' } }),
  }), /signature|SVG/i);
  assert.deepEqual((await readdir(paths.mediaRoot, { recursive: true })).filter((name) => name.endsWith('.svg') || name.endsWith('.part')), []);
});

test('resumes a matching target but refuses to overwrite a mismatching target', async () => {
  // Given
  const paths = await fixture();
  const input = snapshot([reference('existing.png')]);
  const first = await transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({ 'existing.png': { bytes: PNG, mimeType: 'image/png' } }), resume: true });
  const calls = [];

  // When
  await transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({}, calls), resume: true });
  await writeFile(first.candidates[0].absolutePath, Buffer.from('corrupt'));

  // Then
  assert.deepEqual(calls, []);
  await assert.rejects(transferSnapshotMedia({ snapshot: input, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({}), resume: true }), /mismatch|checksum|size/i);
});

test('accepts a pre-existing verified target from authoritative candidate metadata without downloading', async () => {
  // Given
  const paths = await fixture();
  const hash = sha256(PNG);
  const target = deriveMediaTarget({ mediaRoot: paths.mediaRoot, bucket: 'project-media', objectPath: 'known.jpg', sha256: hash, mimeType: 'image/png' }).absolutePath;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, PNG);
  const calls = [];
  const known = reference('known.jpg', storageUrl('known.jpg'), { bytes: PNG.length, sha256: hash, mimeType: 'image/png' });

  // When
  const result = await transferSnapshotMedia({ snapshot: snapshot([known]), mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({}, calls), resume: true });

  // Then
  assert.deepEqual(calls, []);
  assert.equal(result.candidates[0].status, 'completed');
  assert.equal(result.candidates[0].absolutePath, target);
});

test('rejects active SVG content in a pre-existing target with matching metadata', async () => {
  // Given
  const paths = await fixture();
  const activeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path onload="alert(1)"/></svg>');
  const hash = sha256(activeSvg);
  const target = deriveMediaTarget({ mediaRoot: paths.mediaRoot, bucket: 'project-media', objectPath: 'icons/unsafe.svg', sha256: hash, mimeType: 'image/svg+xml' }).absolutePath;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, activeSvg);
  const known = reference('icons/unsafe.svg', storageUrl('icons/unsafe.svg'), { bytes: activeSvg.length, sha256: hash, mimeType: 'image/svg+xml' });

  // When / Then
  await assert.rejects(transferSnapshotMedia({ snapshot: snapshot([known]), mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({}), resume: true }), /SVG|signature/i);
});

test('rejects conflicting duplicate metadata and symlinked roots or ancestors', async () => {
  // Given
  const conflict = snapshot([reference('same.png', storageUrl('same.png'), { bytes: 1 }), reference('same.png', `${storageUrl('same.png')}?x`, { bytes: 2 })]);
  const paths = await fixture();
  const real = join(paths.parent, 'real');
  const linked = join(paths.parent, 'linked');
  await mkdir(real);
  await symlink(real, linked, 'junction');

  // When / Then
  await assert.rejects(transferSnapshotMedia({ snapshot: conflict, mediaRoot: paths.mediaRoot, statePath: paths.statePath, downloader: downloaderFor({}), dryRun: true }), /conflict/i);
  await assert.rejects(transferSnapshotMedia({ snapshot: snapshot([reference('safe.png')]), mediaRoot: linked, statePath: paths.statePath, downloader: downloaderFor({ 'safe.png': { bytes: PNG, mimeType: 'image/png' } }) }), /symlink/i);

  const ancestorPaths = await fixture();
  const outsideImports = join(ancestorPaths.parent, 'outside-imports');
  await mkdir(outsideImports);
  await symlink(outsideImports, join(ancestorPaths.mediaRoot, 'imports'), 'junction');
  await assert.rejects(transferSnapshotMedia({ snapshot: snapshot([reference('safe.png')]), mediaRoot: ancestorPaths.mediaRoot, statePath: ancestorPaths.statePath, downloader: downloaderFor({ 'safe.png': { bytes: PNG, mimeType: 'image/png' } }) }), /symlink/i);
});

test('dry run validates and plans pending candidates without downloader calls or writes', async () => {
  // Given
  const paths = await fixture();
  const calls = [];
  const missingState = join(paths.parent, 'missing', 'state.json');

  // When
  const result = await transferSnapshotMedia({ snapshot: snapshot([reference('plan.png')]), mediaRoot: paths.mediaRoot, statePath: missingState, downloader: downloaderFor({}, calls), dryRun: true });

  // Then
  assert.deepEqual(calls, []);
  assert.equal(result.candidates[0].status, 'pending');
  assert.deepEqual(result.urlRewriteMap, {});
  await assert.rejects(access(missingState));
  assert.deepEqual(await readdir(paths.mediaRoot), []);
});
