import { describe, expect, it } from '@jest/globals';
import { ethers } from 'ethers';
import forEach from 'lodash/forEach';

import dapiFallbackTree from '../../data/dapi-fallback-merkle-tree-root/current-hash.json';
import dapiFallbackTreeSigners from '../../data/dapi-fallback-merkle-tree-root/hash-signers.json';
import dapiManagementTree from '../../data/dapi-management-merkle-tree-root/current-hash.json';
import dapiManagementTreeSigners from '../../data/dapi-management-merkle-tree-root/hash-signers.json';
import dapiPricingTree from '../../data/dapi-pricing-merkle-tree-root/current-hash.json';
import dapiPricingTreeSigners from '../../data/dapi-pricing-merkle-tree-root/hash-signers.json';
import signedApiUrlTree from '../../data/signed-api-url-merkle-tree-root/current-hash.json';
import signedApiUrlTreeSigners from '../../data/signed-api-url-merkle-tree-root/hash-signers.json';
import {
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
  deriveTreeHash,
} from '~/lib/merkle-tree-utils';

describe('dAPI fallback Merkle tree current-hash.json', () => {
  it('has the correct tree root', () => {
    const tree = createDapiFallbackMerkleTree(dapiFallbackTree.merkleTreeValues);
    expect(dapiFallbackTree.hash).toEqual(tree.root);
  });

  // TODO: Enable when the time comes to sign
  describe.skip('signatures', () => {
    it('has keys that match the hash signers array', () => {
      expect(Object.keys(dapiFallbackTree.signatures)).toEqual(dapiFallbackTreeSigners.hashSigners);
    });

    it('only contains verified signatures', () => {
      const hashToSign = deriveTreeHash(
        'dAPI fallback Merkle tree root',
        dapiFallbackTree.hash,
        dapiFallbackTree.timestamp
      );

      forEach(dapiFallbackTree.signatures, (signature, address) => {
        expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
      });
    });
  });
});

describe('dAPI management Merkle tree current-hash.json', () => {
  it('has the correct tree root', () => {
    const tree = createDapiManagementMerkleTree(dapiManagementTree.merkleTreeValues);
    expect(dapiManagementTree.hash).toEqual(tree.root);
  });

  // TODO: Enable when the time comes to sign
  describe.skip('signatures', () => {
    it('has keys that match the hash signers array', () => {
      expect(Object.keys(dapiManagementTree.signatures)).toEqual(dapiManagementTreeSigners.hashSigners);
    });

    it('only contains verified signatures', () => {
      const hashToSign = deriveTreeHash(
        'dAPI fallback Merkle tree root',
        dapiManagementTree.hash,
        dapiManagementTree.timestamp
      );

      forEach(dapiManagementTree.signatures, (signature, address) => {
        expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
      });
    });
  });
});

describe('dAPI pricing Merkle tree current-hash.json', () => {
  it('has the correct tree root', () => {
    const tree = createDapiPricingMerkleTree(dapiPricingTree.merkleTreeValues);
    expect(dapiPricingTree.hash).toEqual(tree.root);
  });

  // TODO: Enable when the time comes to sign
  describe.skip('signatures', () => {
    it('has keys that match the hash signers array', () => {
      expect(Object.keys(dapiPricingTree.signatures)).toEqual(dapiPricingTreeSigners.hashSigners);
    });

    it('only contains verified signatures', () => {
      const hashToSign = deriveTreeHash(
        'dAPI fallback Merkle tree root',
        dapiPricingTree.hash,
        dapiPricingTree.timestamp
      );

      forEach(dapiPricingTree.signatures, (signature, address) => {
        expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
      });
    });
  });
});

describe('Signed API URL Merkle tree current-hash.json', () => {
  it('has the correct tree root', () => {
    const tree = createSignedApiUrlMerkleTree(signedApiUrlTree.merkleTreeValues);
    expect(signedApiUrlTree.hash).toEqual(tree.root);
  });

  // TODO: Enable when the time comes to sign
  describe.skip('signatures', () => {
    it('has keys that match the hash signers array', () => {
      expect(Object.keys(signedApiUrlTree.signatures)).toEqual(signedApiUrlTreeSigners.hashSigners);
    });

    it('only contains verified signatures', () => {
      const hashToSign = deriveTreeHash(
        'dAPI fallback Merkle tree root',
        signedApiUrlTree.hash,
        signedApiUrlTree.timestamp
      );

      forEach(signedApiUrlTree.signatures, (signature, address) => {
        expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
      });
    });
  });
});
