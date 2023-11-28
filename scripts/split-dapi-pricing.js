const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ethers } = require('ethers');
const { createDapiPricingMerkleTree } = require('./utils');

async function splitDapiPricing() {
  const currentHashPath = path.join(__dirname, '..', 'data', 'dapi-pricing-merkle-tree-root', 'current-hash.json');

  const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));

  const values = currentHashData.merkleTreeValues.values;

  const tree = createDapiPricingMerkleTree(currentHashData.merkleTreeValues.values);
  const dict = values.reduce((accumulator, item, idx) => {
    const [dapiName, chainId] = item;
    const name = dapiName.replace('/', '-');
  
    const treeValues = [ethers.utils.formatBytes32String(dapiName), chainId, item[2], item[3], item[4]];
    const proof = tree.getProof(idx);
    const leaf = { value: treeValues, proof };
  
    if (!accumulator[chainId]) {
      accumulator[chainId] = {};
    }
  
    if (!accumulator[chainId][name]) {
      accumulator[chainId][name] = [leaf];
    } else {
      // Clone the existing array and append the new leaf
      accumulator[chainId][name] = [...accumulator[chainId][name], leaf];
    }
  
    return accumulator;
  }, {});

  for (const chainId in dict) {
    for (const dapiName in dict[chainId]) {
      const valueCollection = dict[chainId][dapiName];
      let content = { merkleTreeRoot: tree.root, leaves: valueCollection };

      const dirPath = path.join(__dirname, '..', 'data', 'dapi-pricing-merkle-tree-root', chainId);
      const filePath = path.join(dirPath, `${dapiName}.json`);
      await fs.promises.mkdir(dirPath, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(content, null, 4));
    }
  }

  exec('yarn format');
}

splitDapiPricing().catch((error) => {
  console.error(`Error spliting dapi pricing values:`, error);
  process.exit(1);
});

module.exports = { splitDapiPricing };