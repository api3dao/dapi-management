import { describe, expect, it } from '@jest/globals';
import { deriveTreeHash } from './merkle-tree-utils';

describe('deriveTreeHash', () => {
  it('produces the expected result', () => {
    const result = deriveTreeHash(
      'dAPI fallback Merkle tree root',
      '0x508b6d6bd706095091bc3cb96716d12a8e803f3b2b85a7cdc0274486452de6ec',
      1676940000
    );
    expect(result).toEqual(
      new Uint8Array([
        64, 122, 34, 79, 186, 15, 158, 201, 191, 246, 38, 21, 71, 244, 79, 42, 189, 223, 110, 207, 101, 73, 73, 204, 58,
        109, 86, 105, 29, 194, 201, 121,
      ])
    );
  });
});
