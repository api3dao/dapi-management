const assert = require('node:assert');
const path = require('path');
const { existsSync } = require('fs');
const { ethers } = require('ethers');
const forEach = require('lodash/forEach');
const { getOisTitlesWithAirnodeAddress } = require('@api3/api-integrations');
const currentHashData = require('../../data/signed-api-url-merkle-tree-root/current-hash.json');
const signerData = require('../../data/signed-api-url-merkle-tree-root/hash-signers.json');
const { createSignedApiUrlMerkleTree, deriveTreeHash, getSignedApiUrlHashType } = require('../utils');
const { logSuccessMessage } = require('./utils');

const SIGNATURE_KEYS_CHECK_ENABLED = false;

function verifyData() {
  console.info('Verifying Signed API URL data locally...');

  const tree = createSignedApiUrlMerkleTree(currentHashData.merkleTreeValues);
  assert.equal(currentHashData.hash, tree.root, 'Expected hash to match tree root (current-hash.json)');

  // Verify the previous file's hash
  const previousHashPath = path.join(__dirname, '../../data/signed-api-url-merkle-tree-root/previous-hash.json');
  if (existsSync(previousHashPath)) {
    const previousHashData = require(previousHashPath);
    const previousTree = createSignedApiUrlMerkleTree(previousHashData.merkleTreeValues);
    assert.equal(previousHashData.hash, previousTree.root, 'Expected hash to match tree root (previous-hash.json)');
  }

  // TODO: Remove guard when the time comes to sign
  if (SIGNATURE_KEYS_CHECK_ENABLED) {
    assert.deepEqual(
      Object.keys(currentHashData.signatures),
      signerData.hashSigners,
      'Expected signature keys to match hash signers'
    );
  }

  // Verify signatures
  const hashToSign = deriveTreeHash(getSignedApiUrlHashType(), currentHashData.hash, currentHashData.timestamp);
  forEach(currentHashData.signatures, (signature, address) => {
    assert.equal(address, ethers.utils.verifyMessage(hashToSign, signature), 'Expected all signatures to be valid');
  });

  // Verify that we've got entries in the @api3/api-integrations package for all airnode addresses
  currentHashData.merkleTreeValues.forEach((values) => {
    const apiProviders = getOisTitlesWithAirnodeAddress(values[0]);
    assert(
      apiProviders?.length > 0,
      `Expected to find API providers for airnode address: ${values[0]} in the @api3/api-integrations package`
    );
  });

  logSuccessMessage('Successfully verified');
}

module.exports = {
  verifyData,
};
