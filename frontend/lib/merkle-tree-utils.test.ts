import { describe, expect, it } from '@jest/globals';
import { deriveTreeHash } from './merkle-tree-utils';

describe('deriveTreeHash', () => {
  it('produces the expected result', () => {
    const result = deriveTreeHash(
      'dAPI management Merkle tree root',
      '0x513c019f1736f1880f20b1d45f2a490621657eb78f5b7d811b87458ef28c3092',
      1702556115
    );
    expect(result).toEqual(
      new Uint8Array([
        81, 157, 16,  83,  80, 110,  70,  53,
       142,  65, 94, 204, 192, 225,  18, 141,
        75,  60, 15,  73,  35, 186, 143, 176,
       176,  56,  0,  20, 156,  52,  38, 190
     ])
    );
  });
});
