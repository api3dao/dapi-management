const assert = require('node:assert');
const path = require('path');
const { existsSync } = require('fs');
const { ethers } = require('ethers');
const forEach = require('lodash/forEach');
const dapis = require('../../data/dapis.json');
const currentHashData = require('../../data/dapi-management-merkle-tree-root/current-hash.json');
const signerData = require('../../data/dapi-management-merkle-tree-root/hash-signers.json');
const {
  createDapiManagementMerkleTree,
  deriveTreeHash,
  getDapiManagementHashType,
  deriveDataFeedId,
  deriveSponsorWalletAddress,
} = require('../utils');
const { logSuccessMessage } = require('./utils');

const SIGNATURE_KEYS_CHECK_ENABLED = false;

function verifyData() {
  console.info('Verifying dAPI Management data (before HashRegistry checks)...');

  const tree = createDapiManagementMerkleTree(currentHashData.merkleTreeValues);
  assert.equal(currentHashData.hash, tree.root, 'Expected hash to match tree root (current-hash.json)');

  // Verify the previous file's hash
  const previousHashPath = path.join(__dirname, '../../data/dapi-management-merkle-tree-root/previous-hash.json');
  if (existsSync(previousHashPath)) {
    const previousHashData = require(previousHashPath);
    const previousTree = createDapiManagementMerkleTree(previousHashData.merkleTreeValues);
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
  const hashToSign = deriveTreeHash(getDapiManagementHashType(), currentHashData.hash, currentHashData.timestamp);
  forEach(currentHashData.signatures, (signature, address) => {
    assert.equal(address, ethers.utils.verifyMessage(hashToSign, signature), 'Expected all signatures to be valid');
  });

  // Verify merkle tree values
  currentHashData.merkleTreeValues.forEach((values) => {
    const dapiName = ethers.utils.parseBytes32String(values[0]);
    const entry = dapis.find((dapi) => dapi.name === dapiName);
    assert(entry != null, `Missing entry for ${dapiName} in the data/dapis.json file`);

    // Verify data feed ID
    assert.equal(
      values[1],
      deriveDataFeedId(dapiName, entry.providers),
      `Expected Data Feed ID to be derived from ${dapiName}`
    );

    // Verify sponsor wallet address
    assert.equal(
      values[2],
      deriveSponsorWalletAddress(values[0]),
      `Expected Sponsor Wallet Address to be derived from ${dapiName}`
    );
  });

  logSuccessMessage('Successfully verified');
}

module.exports = {
  verifyData,
};
