import { describe, expect, it } from 'vitest';
import { constantTimeEqual, generateOpaqueToken, sha256, verifyTokenDigest } from '../src/lib/server/auth/crypto';
import { hashPassword, verifyPassword } from '../src/lib/server/auth/password';

describe('opaque auth secrets', () => {
  it('generates independent 256-bit base64url tokens', () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
  });

  it('stores and verifies only SHA-256 digests', () => {
    const token = generateOpaqueToken();
    const digest = sha256(token);

    expect(digest).toHaveLength(32);
    expect(verifyTokenDigest(token, digest)).toBe(true);
    expect(verifyTokenDigest(`${token}x`, digest)).toBe(false);
    expect(constantTimeEqual(digest, digest.subarray(0, 31))).toBe(false);
  });
});

describe('Argon2id passwords', () => {
  it('provisions a salted Argon2id hash and verifies it', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$v=19\$/u);
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
    await expect(hashPassword('correct horse battery staple')).resolves.not.toBe(hash);
  });
});
