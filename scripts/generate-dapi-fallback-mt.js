const fs = require('fs');
const { ethers } = require('ethers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { getAirnodeAddressByAlias, deriveDataFeedId } = require('api-integrations');
const { computeSponsorWalletAddress } = require('@nodary/utilities');

const MT_OUTPUT_PATH = './data/dapi-fallback-merkle-tree-root/current-hash.json';

function generateDapiManagementMT() {
  const dapis = JSON.parse(fs.readFileSync('./data/dapis.json').toString());

  const merkleTreeValues = dapis.map(({ name, providers }) => {
    // derive data feed ID
    if (!providers.includes('nodary')) {
      throw Error(`Nodary is not in providers of ${name}`);
    }
    const airnodeAddress = getAirnodeAddressByAlias('nodary');
    const dataFeedId = deriveDataFeedId(name, airnodeAddress);

    // derive sponsor wallet address
    const sponsorWalletAddress = computeSponsorWalletAddress(name, 1 * 1e6, 0, 86400);

    return [ethers.utils.formatBytes32String(name), dataFeedId, sponsorWalletAddress];
  });

  const tree = StandardMerkleTree.of(merkleTreeValues, ['bytes32', 'bytes32', 'address']);

  const dapiManagementMT = {
    timestamp: Math.floor(Date.now() / 1000),
    hash: tree.root,
    signatures: {},
    merkleTreeValues: merkleTreeValues,
  };

  fs.writeFileSync(MT_OUTPUT_PATH, JSON.stringify(dapiManagementMT, null, 2));
}

generateDapiManagementMT();
