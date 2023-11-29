const fs = require('fs');
const path = require('path');
const { promisify } = 'util';
const { exec } = require('child_process');
const { ethers } = require('ethers');
const { createDapiPricingMerkleTree } = require('./utils');

async function splitDapiPricing() {
  const dirPath = path.join(__dirname, '..', 'data', 'dapi-pricing-merkle-tree-root');
  const currentHashPath = path.join(dirPath, 'current-hash.json');

  const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));
  const { merkleTreeValues, ...metadata } = currentHashData;

  const tree = createDapiPricingMerkleTree(merkleTreeValues);
  let valuesByChainAndDapiName = {};
  for (const [idx, item] of tree.entries()) {
    const [hashedDapiName, chainId] = item;
    const dapiName = ethers.utils.parseBytes32String(hashedDapiName);
    const name = dapiName.replace('/', '-');

    const proof = tree.getProof(idx);
    const leaf = { value: item, proof };

    if (!valuesByChainAndDapiName[chainId]) {
      valuesByChainAndDapiName[chainId] = {};
    }

    if (!valuesByChainAndDapiName[chainId][name]) {
      valuesByChainAndDapiName[chainId][name] = [leaf];
    } else {
      // Clone the existing array and append the new leaf
      valuesByChainAndDapiName[chainId][name].push(leaf);
    }
  }

  for (const chainId in valuesByChainAndDapiName) {
    for (const dapiName in valuesByChainAndDapiName[chainId]) {
      const valueCollection = valuesByChainAndDapiName[chainId][dapiName];
      const content = { merkleTreeRoot: tree.root, leaves: valueCollection };

      const chainPath = path.json(dirPath, chainId);
      const filePath = path.json(chainPath, `${dapiName}.json`);
      await fs.promises.mkdir(chainPath, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(content, null, 4));
    }
  }

  const metadatPath = path.join(dirPath, 'metadata.json');
  fs.writeFileSync(metadatPath, JSON.stringify(metadata, null, 4));

  const execute = promisify(exec);
  await execute('yarn format');
}

splitDapiPricing().catch((error) => {
  console.error(`Error spliting dapi pricing values:`, error);
  process.exit(1);
});

module.exports = { splitDapiPricing };
