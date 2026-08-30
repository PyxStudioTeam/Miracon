import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseStorageDownloader } from '../scripts/migration/supabase-storage-downloader.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('adapter png')]);

function storageClient(response) {
  const calls = [];
  return {
    calls,
    storage: {
      from(bucket) {
        calls.push({ operation: 'from', bucket });
        return {
          async download(objectPath) {
            calls.push({ operation: 'download', objectPath });
            return typeof response === 'function' ? response() : response;
          },
        };
      },
    },
  };
}

test('downloads the exact validated bucket and object path as an async iterable', async () => {
  // Given
  const client = storageClient({ data: new Blob([PNG], { type: 'image/png' }), error: null });
  const downloader = createSupabaseStorageDownloader(client);

  // When
  const result = await downloader({ bucket: 'project-media', objectPath: 'gallery/hero.png', originalUrls: ['https://example.test/hero.png'] });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));

  // Then
  assert.deepEqual(client.calls, [
    { operation: 'from', bucket: 'project-media' },
    { operation: 'download', objectPath: 'gallery/hero.png' },
  ]);
  assert.equal(Buffer.concat(chunks).toString('hex'), PNG.toString('hex'));
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.bytes, PNG.length);
});

test('rejects an invalid storage path before invoking the client', async () => {
  // Given
  const client = storageClient({ data: new Blob([PNG], { type: 'image/png' }), error: null });
  const downloader = createSupabaseStorageDownloader(client);

  // When / Then
  await assert.rejects(downloader({ bucket: 'project-media', objectPath: '../secret.png', originalUrls: [] }), /storage|path|traversal/i);
  assert.deepEqual(client.calls, []);
});

test('maps API, thrown SDK, and invalid responses to fixed safe errors', async () => {
  // Given
  const secret = 'service-role-secret';
  const sourceUrl = 'https://private-project.supabase.co/storage/v1/object/private';
  const cases = [
    storageClient({ data: null, error: { message: `${secret} ${sourceUrl}`, body: 'private response' } }),
    storageClient(() => { throw new Error(`${secret} ${sourceUrl}`); }),
    storageClient({ data: { type: 'image/png', size: PNG.length, stream: 'not-a-function' }, error: null }),
  ];

  // When / Then
  for (const client of cases) {
    const downloader = createSupabaseStorageDownloader(client);
    await assert.rejects(downloader({ bucket: 'project-media', objectPath: 'safe.png', originalUrls: [] }), (error) => {
      assert.match(error.message, /^Supabase Storage (download failed|returned an invalid response)$/u);
      assert.doesNotMatch(error.message, new RegExp(`${secret}|private-project|private response`, 'iu'));
      return true;
    });
  }
});
