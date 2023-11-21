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

describe('dAPI fallback Merkle tree values', () => {
  it('has the correct tree root', () => {
    const tree = createDapiFallbackMerkleTree(dapiFallbackTree.merkleTreeValues.values);
    expect(dapiFallbackTree.hash).toEqual(tree.root);
  });

  it.skip('has no pending signatures', () => {
    expect(Object.keys(dapiFallbackTree.signatures).sort()).toEqual(dapiFallbackTreeSigners.hashSigners.sort());

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

describe('dAPI management Merkle tree values', () => {
  it('has the correct tree root', () => {
    const tree = createDapiManagementMerkleTree(dapiManagementTree.merkleTreeValues.values);
    expect(dapiManagementTree.hash).toEqual(tree.root);
  });

  it.skip('has no pending signatures', () => {
    expect(Object.keys(dapiManagementTree.signatures).sort()).toEqual(dapiManagementTreeSigners.hashSigners.sort());

    const hashToSign = deriveTreeHash(
      'dAPI management Merkle tree root',
      dapiManagementTree.hash,
      dapiManagementTree.timestamp
    );

    forEach(dapiManagementTree.signatures, (signature, address) => {
      expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
    });
  });
});

describe('dAPI pricing Merkle tree values', () => {
  it('has the correct tree root', () => {
    const tree = createDapiPricingMerkleTree(dapiPricingTree.merkleTreeValues.values);
    expect(dapiPricingTree.hash).toEqual(tree.root);
  });

  it.skip('has no pending signatures', () => {
    expect(Object.keys(dapiPricingTree.signatures).sort()).toEqual(dapiPricingTreeSigners.hashSigners.sort());

    const hashToSign = deriveTreeHash('dAPI pricing Merkle tree root', dapiPricingTree.hash, dapiPricingTree.timestamp);

    forEach(dapiPricingTree.signatures, (signature, address) => {
      expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
    });
  });
});

describe('Signed API URL Merkle tree values', () => {
  it('has the correct tree root', () => {
    const tree = createSignedApiUrlMerkleTree(signedApiUrlTree.merkleTreeValues.values);
    expect(signedApiUrlTree.hash).toEqual(tree.root);
  });

  it.skip('has no pending signatures', () => {
    expect(Object.keys(signedApiUrlTree.signatures).sort()).toEqual(signedApiUrlTreeSigners.hashSigners.sort());

    const hashToSign = deriveTreeHash(
      'Signed API URL Merkle tree root',
      signedApiUrlTree.hash,
      signedApiUrlTree.timestamp
    );

    forEach(signedApiUrlTree.signatures, (signature, address) => {
      expect(ethers.utils.verifyMessage(hashToSign, signature)).toEqual(address);
    });
  });
});
