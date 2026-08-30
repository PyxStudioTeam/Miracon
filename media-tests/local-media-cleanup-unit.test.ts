import { describe, expect, it } from 'vitest';
import { LocalMediaCleanupError, parseLocalMediaCleanupArguments } from '../scripts/local-media-cleanup.mjs';

describe('local media cleanup arguments', () => {
  it('requires apply when the operator asserts exclusive-writer mode', () => {
    expect(() => parseLocalMediaCleanupArguments(['--exclusive-writer'])).toThrow(LocalMediaCleanupError);
  });

  it('rejects apply without the exclusive-writer assertion', () => {
    expect(() => parseLocalMediaCleanupArguments(['--apply'])).toThrow(LocalMediaCleanupError);
  });

  it('accepts an explicit exclusive apply contract', () => {
    expect(parseLocalMediaCleanupArguments(['--apply', '--exclusive-writer'])).toEqual({
      apply: true,
      exclusiveWriter: true,
      graceDays: 7,
    });
  });
});
