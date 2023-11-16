const fs = require('fs');
const path = require('path');
const nodaryUtilities = require('@nodary/utilities');
const { exec } = require('child_process');
const { createDapiFallbackMerkleTree } = require('./utils');

async function syncDapiFallbackValues() {
  const currentHashPath = path.join(__dirname, '..', 'data', 'dapi-fallback-merkle-tree-root', 'current-hash.json');
  const previousHashPath = path.join(__dirname, '..', 'data', 'dapi-fallback-merkle-tree-root', 'previous-hash.json');
  if (!fs.existsSync(currentHashPath)) {
    console.info('Current hash file not found');
    process.exit(1);
  }

  const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));

  const { tree, values } = getNodaryFallbackTree();

  if (currentHashData.hash === tree.root) {
    console.info('Current hash file is up to date.');
  } else {
    console.info('Syncing hash file with nodary data feeds.');
    fs.writeFileSync(previousHashPath, JSON.stringify(currentHashData, null, 4));

    const merkleTeeData = {
      timestamp: new Date().getTime(),
      hash: tree.root,
      signatures: {},
      merkleTreeValues: { values },
    };
    fs.writeFileSync(currentHashPath, JSON.stringify(merkleTeeData, null, 4));

    exec('yarn format');
    console.info('Current hash file updated.');
  }
}

// See https://github.com/nodaryio/utilities/issues/14
const ONE_PERCENT_NORMALIZED = 1 * 1e6;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

function getNodaryFallbackTree() {
  const values = nodaryUtilities.nodaryFeeds.map((nodaryFeed) => {
    return [
      nodaryFeed.name,
      nodaryUtilities.computeFeedId(nodaryFeed.name),
      nodaryUtilities.computeSponsorWalletAddress(nodaryFeed.name, ONE_PERCENT_NORMALIZED, 0, ONE_DAY_IN_SECONDS),
    ];
  });

  return { tree: createDapiFallbackMerkleTree(values), values };
}

syncDapiFallbackValues().catch((error) => {
  console.error(`Error processing dapi fallback sync:`, error);
  process.exit(1);
});

module.exports = { syncDapiFallbackValues };
