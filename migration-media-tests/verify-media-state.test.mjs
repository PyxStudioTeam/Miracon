import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyMediaState } from '../scripts/migration/media-state-verifier.mjs';

const bytes = Buffer.from('recipient-side verified media');
const digest = createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-media-verify-'));
  const mediaRoot = join(parent, 'host-media');
  const relativePath = 'imports/project-media/verified.bin';
  await mkdir(dirname(join(mediaRoot, relativePath)), { recursive: true });
  await writeFile(join(mediaRoot, relativePath), bytes);
  const state = {
    version: 'miracon-media-transfer/v1',
    snapshotId: `snapshot-${'a'.repeat(64)}`,
    contentHash: 'a'.repeat(64),
    records: [{ key: 'project-media/source.bin', status: 'completed', relativePath, absolutePath: 'C:\\workstation\\wrong.bin', bytes: bytes.length, sha256: digest }],
  };
  return { parent, mediaRoot, state };
}

test('verifies completed records from relative paths beneath the supplied host root', async () => {
  // Given
  const { mediaRoot, state } = await fixture();

  // When
  const result = await verifyMediaState({ mediaRoot, mediaState: state });

  // Then
  assert.deepEqual(result, { snapshotId: state.snapshotId, contentHash: state.contentHash, files: 1, bytes: bytes.length });
});

test('rejects identity drift, incomplete records, duplicate paths, escapes, and hash mismatches', async () => {
  // Given
  const cases = [];
  const identity = await fixture(); identity.state.snapshotId = `snapshot-${'b'.repeat(64)}`; cases.push([identity, /identity/i]);
  const pending = await fixture(); pending.state.records[0].status = 'pending'; cases.push([pending, /completed/i]);
  const duplicate = await fixture(); duplicate.state.records.push({ ...duplicate.state.records[0], key: 'project-media/other.bin' }); cases.push([duplicate, /duplicate/i]);
  const escape = await fixture(); escape.state.records[0].relativePath = '../outside.bin'; cases.push([escape, /relative|escape|path/i]);
  const encodedEscape = await fixture(); encodedEscape.state.records[0].relativePath = 'imports/%252e%252e/outside.bin'; cases.push([encodedEscape, /traversal|path/i]);
  const mismatch = await fixture(); await writeFile(join(mismatch.mediaRoot, mismatch.state.records[0].relativePath), Buffer.from('tampered')); cases.push([mismatch, /checksum|byte|mismatch/i]);

  // When / Then
  for (const [input, message] of cases) await assert.rejects(verifyMediaState({ mediaRoot: input.mediaRoot, mediaState: input.state }), message);
});

test('rejects symlinked media ancestors when the platform permits links', async (context) => {
  // Given
  const { parent, mediaRoot, state } = await fixture();
  const outside = join(parent, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'verified.bin'), bytes);
  const imports = join(mediaRoot, 'imports');
  try {
    await symlink(outside, imports, 'junction');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      state.records[0].relativePath = 'linked/verified.bin';
      await symlink(outside, join(mediaRoot, 'linked'), 'junction');
    } else if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      context.skip('Creating symlinks is not permitted on this platform');
      return;
    } else throw error;
  }

  // When
  const verification = verifyMediaState({ mediaRoot, mediaState: state });

  // Then
  await assert.rejects(verification, /symlink/i);
});
