import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createMediaRoot, mimeContractFor, saveMediaFile } from '../src/lib/server/media';
import type { MediaFileRepository } from '../src/lib/server/media';

const temporaryRoots: string[] = [];
const repository: MediaFileRepository = { async insert() {} };

const signatures = [
  { mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
  { mimeType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/webp', bytes: Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary') },
  { mimeType: 'image/avif', bytes: Buffer.from('\x00\x00\x00\x18ftypavif\x00\x00\x00\x00avif', 'binary') },
  { mimeType: 'video/mp4', bytes: Buffer.from('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom', 'binary') },
  { mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n') },
] as const;

const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M2 12h20"/></svg>');
const cssEscapedUrlSvg = Buffer.from(String.raw`<svg xmlns="http://www.w3.org/2000/svg">
  <path filter="u\72l(&quot;https://attacker.test/filter.svg#x&quot;)"/>
</svg>`);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('media content signatures', () => {
  for (const signature of signatures) {
    it(`accepts a valid ${signature.mimeType} signature`, async () => {
      // Given
      const root = await mediaRoot();

      // When
      const saved = await saveMediaFile({ root, source: Readable.from([signature.bytes]), mimeType: signature.mimeType, repository });

      // Then
      expect(saved).toMatchObject({ ok: true, value: { mimeType: signature.mimeType } });
    });
  }

  it('accepts a passive SVG icon', async () => {
    // Given
    const root = await mediaRoot();

    // When
    const svg = await saveMediaFile({ root, source: Readable.from([safeSvg]), mimeType: 'image/svg+xml', repository });

    // Then
    expect(svg).toMatchObject({ ok: true, value: { mimeType: 'image/svg+xml' } });
    if (!svg.ok) throw new Error(svg.error.message);
    expect(svg.value.relativePath).toMatch(/\.svg$/u);
  });

  it('rejects an SVG with a CSS-escaped external URL without publishing', async () => {
    // Given
    const root = await mediaRoot();

    // When
    const svg = await saveMediaFile({ root, source: Readable.from([cssEscapedUrlSvg]), mimeType: 'image/svg+xml', repository });

    // Then
    expect(svg).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Media content does not match its MIME type' } });
    expect(await readdir(join(root.path, 'uploads'))).toEqual([]);
  });

  it('rejects fake binary signatures and active SVG content without publishing', async () => {
    // Given
    const root = await mediaRoot();
    const unsafeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    // When
    const fakeVideo = await saveMediaFile({ root, source: Readable.from([Buffer.from('not an mp4')]), mimeType: 'video/mp4', repository });
    const svg = await saveMediaFile({ root, source: Readable.from([unsafeSvg]), mimeType: 'image/svg+xml', repository });

    // Then
    expect(fakeVideo).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Media content does not match its MIME type' } });
    expect(svg).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Media content does not match its MIME type' } });
    expect(await readdir(join(root.path, 'uploads'))).toEqual([]);
  });
});

describe('MEDIA_ROOT initialization', () => {
  it('rejects root and managed-directory junctions and caches successful initialization by root', async () => {
    // Given
    const outside = await temporaryRoot();
    const linkedRoot = await unusedPath();
    const managedRoot = await temporaryRoot();
    await symlink(outside, linkedRoot, 'junction');
    await symlink(outside, join(managedRoot, '.tmp'), 'junction');
    const cachedRoot = await temporaryRoot();

    // When
    const linked = await createMediaRoot(linkedRoot);
    const managed = await createMediaRoot(managedRoot);
    const first = await createMediaRoot(cachedRoot);
    await rm(join(cachedRoot, '.tmp'), { recursive: true });
    const repeated = await createMediaRoot(cachedRoot);

    // Then
    expect(linked).toEqual({ ok: false, error: { kind: 'configuration', message: 'MEDIA_ROOT must not be a symbolic link' } });
    expect(managed).toEqual({ ok: false, error: { kind: 'configuration', message: 'MEDIA_ROOT managed directories must not be symbolic links' } });
    expect(first).toMatchObject({ ok: true, value: { path: cachedRoot } });
    expect(repeated).toMatchObject({ ok: true, value: { path: cachedRoot } });
    await expect(readdir(join(cachedRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-hardening-'));
  temporaryRoots.push(root);
  return root;
}

async function unusedPath(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'miracon-media-link-'));
  await rm(path, { recursive: true });
  temporaryRoots.push(path);
  return path;
}

async function mediaRoot() {
  const configured = await createMediaRoot(await temporaryRoot());
  if (!configured.ok) throw new Error(configured.error.message);
  return configured.value;
}
