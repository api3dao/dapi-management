const fs = require('fs');
const { ethers } = require('ethers');
const { createDapiManagementMerkleTree, deriveDataFeedId, deriveSponsorWalletAddress } = require('./utils');
const { execSync } = require('child_process');
const dapis = require('../data/dapis.json');

const MT_OUTPUT_PATH = './data/dapi-management-merkle-tree-root/current-hash.json';

function generateDapiManagementMT() {
  const merkleTreeValues = dapis.map(({ name, providers }) => {
    const dataFeedId = deriveDataFeedId(name, providers);

    // derive sponsor wallet address
    const dapiNameInBytes32 = ethers.utils.formatBytes32String(name);
    const sponsorWalletAddress = deriveSponsorWalletAddress(dapiNameInBytes32);

    return [dapiNameInBytes32, dataFeedId, sponsorWalletAddress];
  });

  const tree = createDapiManagementMerkleTree(merkleTreeValues);

  const dapiManagementMT = {
    timestamp: Math.floor(Date.now() / 1000),
    hash: tree.root,
    signatures: {},
    merkleTreeValues,
  };

  // save the previous hash
  const previousDapiManagementMT = JSON.parse(fs.readFileSync(MT_OUTPUT_PATH, 'utf-8'));
  fs.writeFileSync(
    MT_OUTPUT_PATH.replace('current-hash', 'previous-hash'),
    JSON.stringify(previousDapiManagementMT, null, 2)
  );
  // save the current hash
  fs.writeFileSync(MT_OUTPUT_PATH, JSON.stringify(dapiManagementMT, null, 2));

  execSync('yarn format');
}

generateDapiManagementMT();
