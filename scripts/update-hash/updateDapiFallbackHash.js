const fs = require('fs');
const path = require('path');
const nodaryUtilities = require('@nodary/utilities');
const { isEqual } = require('lodash');
const { exec } = require('child_process');

const merkleType = process.argv[2];

const MERKLE_TREE_MAPPING = {
  price: 'dapi-pricing-merkle-tree-root',
  'dapi management': 'dapi-management-merkle-tree-root',
  'dapi fallback': 'dapi-fallback-merkle-tree-root',
  'api integration': 'signed-api-url-merkle-tree-root',
};

if (!MERKLE_TREE_MAPPING[merkleType]) {
  console.error('You must provide a valid Merkle type as an argument!');
  process.exit(1);
}

async function updateDapiFallbackHash(merkleTreeName) {
  const folderName = MERKLE_TREE_MAPPING[merkleTreeName];

  // Read metadata to get the root signers
  const currentHashPath = path.join(__dirname, '../..', 'data', folderName, 'current-hash.json');
  const previousHashPath = path.join(__dirname, '../..', 'data', folderName, 'previous-hash.json');
  if (!fs.existsSync(currentHashPath)) {
    console.info('Current hash file not found');
    process.exit(1);
  }

  const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));
  const currentHashValues = currentHashData.merkleTreeValues ? currentHashData.merkleTreeValues.values : [];

  const values = getNodaryFallbackValues();

  if (isEqual(currentHashValues, values)) {
    console.info('Current hash file is up to date!');
  } else {
    console.info('Syncing hash file with nodary data feeds!');
    fs.writeFileSync(previousHashPath, JSON.stringify(currentHashData, null, 4));

    for (let item of Object.keys(currentHashData.signatures)) {
      currentHashData.signatures[item] = '0x';
    }

    const updatedData = { ...currentHashData, merkleTreeValues: { values } };
    fs.writeFileSync(currentHashPath, JSON.stringify(updatedData, null, 4));

    exec('yarn prettier');
    console.info('Current hash file updated!');
  }
}

// See https://github.com/nodaryio/utilities/issues/14
const ONE_PERCENT_NORMALIZED = 1 * 1e6;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

function getNodaryFallbackValues() {
  return nodaryUtilities.nodaryFeeds.map((nodaryFeed) => {
    return [
      nodaryFeed.name,
      nodaryUtilities.computeFeedId(nodaryFeed.name),
      nodaryUtilities.computeSponsorWalletAddress(nodaryFeed.name, ONE_PERCENT_NORMALIZED, 0, ONE_DAY_IN_SECONDS),
    ];
  });
}

updateDapiFallbackHash(merkleType).catch((error) => {
  console.error(`Error processing ${merkleType}:`, error);
  process.exit(1);
});

module.exports = { updateDapiFallbackHash };
