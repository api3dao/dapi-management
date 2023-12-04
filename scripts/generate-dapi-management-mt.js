const fs = require('fs');
const { ethers } = require('ethers');
const { deriveBeaconSetId, createDapiManagementMerkleTree } = require('./utils');
const { getAirnodeAddressByAlias, deriveDataFeedId } = require('@api3/api-integrations');
const { deriveWalletPathFromSponsorAddress } = require('@api3/airnode-node/dist/src/evm');
const { execSync } = require('child_process');

const MT_OUTPUT_PATH = './data/dapi-management-merkle-tree-root/current-hash.json';
const PROTOCOL_ID_AIRSEEKER = '5';

function generateDapiManagementMT() {
  const dapis = JSON.parse(fs.readFileSync('./data/dapis.json', 'utf-8'));
  const { airseekerXPub } = JSON.parse(fs.readFileSync('./data/airseeker.json', 'utf-8'));

  const merkleTreeValues = dapis.map(({ name, providers }) => {
    // derive data feed ID
    let dataFeedId = '';
    if (providers.length === 1) {
      if (providers[0] !== 'nodary') {
        throw Error('If dAPI has only one provider, it must be Nodary.');
      }
      const airnodeAddress = getAirnodeAddressByAlias(providers[0]);
      dataFeedId = deriveDataFeedId(name, airnodeAddress);
    } else {
      dataFeedId = deriveBeaconSetId(name, providers);
    }

    // derive sponsor wallet address
    const dapiNameInBytes32 = ethers.utils.formatBytes32String(name);
    const sponsorAddress = ethers.utils.getAddress(dapiNameInBytes32.slice(0, 42));
    const airnodeHdNode = ethers.utils.HDNode.fromExtendedKey(airseekerXPub);
    const sponsorWalletAddress = airnodeHdNode.derivePath(
      deriveWalletPathFromSponsorAddress(sponsorAddress, PROTOCOL_ID_AIRSEEKER)
    ).address;

    return [dapiNameInBytes32, dataFeedId, sponsorWalletAddress];
  });

  const tree = createDapiManagementMerkleTree(merkleTreeValues);

  const dapiManagementMT = {
    timestamp: Math.floor(Date.now() / 1000),
    hash: tree.root,
    signatures: {},
    merkleTreeValues,
  };

  // save the current hash
  fs.writeFileSync(MT_OUTPUT_PATH, JSON.stringify(dapiManagementMT, null, 2));
  // save the previous hash
  const previousDapiManagementMT = JSON.parse(fs.readFileSync(MT_OUTPUT_PATH, 'utf-8'));
  fs.writeFileSync(
    MT_OUTPUT_PATH.replace('current-hash', 'previous-hash'),
    JSON.stringify(previousDapiManagementMT, null, 2)
  );
  execSync('yarn format');
}

generateDapiManagementMT();
