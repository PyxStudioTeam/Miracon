import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, HEAD } from '../src/pages/media/[...path]';

const uuid = '12345678-1234-4abc-8def-1234567890ab';
const uploadedPath = `uploads/${uuid}/${uuid}.mp4`;
const source = Buffer.from('0123456789');
let mediaRoot = '';

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'miracon-media-route-'));
  process.env.MEDIA_ROOT = mediaRoot;
  await mkdir(dirname(join(mediaRoot, uploadedPath)), { recursive: true });
  await writeFile(join(mediaRoot, uploadedPath), source);
});

afterEach(async () => {
  delete process.env.MEDIA_ROOT;
  await rm(mediaRoot, { recursive: true, force: true });
});

describe('uploaded media response caching', () => {
  it('marks full, range, and HEAD responses for UUID upload URLs as immutable', async () => {
    // Given
    const range = { headers: { range: 'bytes=2-5' } };

    // When
    const full = await GET(context(uploadedPath));
    const partial = await GET(context(uploadedPath, range));
    const head = await HEAD(context(uploadedPath));

    // Then
    expect(full.status).toBe(200);
    expect(full.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await full.text()).toBe(source.toString());
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await partial.text()).toBe('2345');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('10');
    expect(head.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await head.text()).toBe('');
  });

  it('serves JPEG and PNG uploads with their source MIME type and bytes', async () => {
    // Given
    const images = [
      { extension: 'jpg', mimeType: 'image/jpeg', source: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
      { extension: 'png', mimeType: 'image/png', source: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ] as const;
    const paths = images.map((image) => `uploads/${uuid}/${uuid}.${image.extension}`);
    await Promise.all(paths.map((path, index) => writeFile(join(mediaRoot, path), images[index].source)));

    // When
    const responses = await Promise.all(paths.map((path) => GET(context(path))));

    // Then
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(images[index].mimeType);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(images[index].source);
    }
  });

  it('does not attach immutable caching to legacy paths or UUID error responses', async () => {
    // Given
    const legacyPath = 'legacy/clip.mp4';
    await mkdir(dirname(join(mediaRoot, legacyPath)), { recursive: true });
    await writeFile(join(mediaRoot, legacyPath), source);

    // When
    const legacy = await GET(context(legacyPath));
    const invalidRange = await GET(context(uploadedPath, { headers: { range: 'bytes=99-100' } }));
    const missingPath = uploadedPath.replace(uuid, '00000000-0000-4000-8000-000000000000').replace(uuid, '00000000-0000-4000-8000-000000000000');
    const missing = await GET(context(missingPath));

    // Then
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get('cache-control')).toBeNull();
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get('cache-control')).toBeNull();
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBeNull();
  });
});

function context(path: string, init: RequestInit = {}) {
  return {
    request: new Request(`https://miracon.test/media/${path}`, init),
    params: { path },
  };
}
