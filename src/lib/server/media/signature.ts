import { fail, succeed } from './types';
import type { MediaResult } from './types';
import { isSafeSvg } from './svg-policy.mjs';

export const MEDIA_SIGNATURE_BYTES = 32;

export function verifyMediaSignature(mimeType: string, bytes: Buffer): MediaResult<void> {
  const valid = signatureMatches(mimeType, bytes);
  return valid ? succeed(undefined) : fail('invalid_upload', 'Media content does not match its MIME type');
}

function signatureMatches(mimeType: string, bytes: Buffer): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'image/avif':
      return hasFtypBrand(bytes, ['avif', 'avis']);
    case 'image/svg+xml':
      return isSafeSvg(bytes);
    case 'video/mp4':
      return hasFtypBrand(bytes, ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash']);
    case 'application/pdf':
      return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    default:
      return false;
  }
}

function hasFtypBrand(bytes: Buffer, brands: readonly string[]): boolean {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const declaredSize = bytes.readUInt32BE(0);
  if (declaredSize < 16) return false;
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, declaredSize); offset += 4) {
    if (brands.includes(bytes.subarray(offset, offset + 4).toString('ascii'))) return true;
  }
  return false;
}
