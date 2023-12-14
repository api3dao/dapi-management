const fs = require('fs');
const { execSync } = require('child_process');
const { createDapiPricingMerkleTree } = require('./utils');

const MT_INPUT_PATH = './scripts/dapi-pricing-mt-input.json';
const MT_OUTPUT_PATH = './data/dapi-pricing-merkle-tree-root/current-hash.json';

async function generateDapiPricingMT() {
  const merkleTreeValues = JSON.parse(fs.readFileSync(MT_INPUT_PATH, 'utf8'));

  const tree = createDapiPricingMerkleTree(merkleTreeValues);

  const dapiPricingMT = {
    timestamp: Math.floor(Date.now() / 1000),
    hash: tree.root,
    signatures: {},
    merkleTreeValues,
  };

  const previousDapiPricingMT = JSON.parse(fs.readFileSync(MT_OUTPUT_PATH, 'utf-8'));
  fs.writeFileSync(
    MT_OUTPUT_PATH.replace('current-hash', 'previous-hash'),
    JSON.stringify(previousDapiPricingMT, null, 2)
  );

  fs.writeFileSync(MT_OUTPUT_PATH, JSON.stringify(dapiPricingMT, null, 2));

  execSync('yarn format');
}

generateDapiPricingMT();
