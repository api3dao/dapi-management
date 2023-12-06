const assert = require('node:assert');
const { ethers } = require('ethers');
const forEach = require('lodash/forEach');
const currentHashData = require('../../data/dapi-pricing-merkle-tree-root/current-hash.json');
const signerData = require('../../data/dapi-pricing-merkle-tree-root/hash-signers.json');
const { createDapiPricingMerkleTree, deriveTreeHash, getDapiPricingHashType } = require('../utils');

const SIGNATURE_KEYS_CHECK_ENABLED = false;

function verifyData() {
  console.info('Verifying dAPI Pricing data locally...');

  const tree = createDapiPricingMerkleTree(currentHashData.merkleTreeValues);
  assert.equal(currentHashData.hash, tree.root, 'Expected hash to match tree root (current-hash.json)');

  // TODO: Remove guard when the time comes to sign
  if (SIGNATURE_KEYS_CHECK_ENABLED) {
    assert.deepEqual(
      Object.keys(currentHashData.signatures),
      signerData.hashSigners,
      'Expected signature keys to match hash signers'
    );
  }

  // Verify signatures
  const hashToSign = deriveTreeHash(getDapiPricingHashType(), currentHashData.hash, currentHashData.timestamp);
  forEach(currentHashData.signatures, (signature, address) => {
    assert.equal(address, ethers.utils.verifyMessage(hashToSign, signature), 'Expected all signatures to be valid');
  });

  console.log('\x1b[32m%s\x1b[0m', 'Successfully verified');
}

module.exports = {
  verifyData,
};
