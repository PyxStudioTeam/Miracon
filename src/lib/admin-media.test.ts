import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizePhotoForDirectUpload } from './admin-media';

const highResolutionImageTypes = [
  ['image/jpeg', 'architecture-source.jpg'],
  ['image/png', 'floor-plan-source.png'],
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('optimizePhotoForDirectUpload', () => {
  for (const [mimeType, name] of highResolutionImageTypes) {
    it(`preserves a high-resolution ${mimeType} source without WebP transcoding`, async () => {
      // Given
      const sourceBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x90, 0x00, 0x1f, 0x5a]);
      const source = new File([sourceBytes], name, { lastModified: 1_710_000_000_000, type: mimeType });
      const createElement = vi.fn();
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4_800, height: 3_200, close: vi.fn() }));
      vi.stubGlobal('document', { createElement });

      // When
      const uploaded = await optimizePhotoForDirectUpload(source);

      // Then
      expect(uploaded).toBe(source);
      expect(uploaded).toMatchObject({ lastModified: source.lastModified, name, size: source.size, type: mimeType });
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(sourceBytes);
      expect(createElement).not.toHaveBeenCalled();
    });
  }
});
