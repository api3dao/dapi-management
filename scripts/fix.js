const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ethers } = require('ethers');

async function syncDapiFallbackValues() {
  const currentHashPaths = [
    // path.join(__dirname, '..', 'data', 'dapi-fallback-merkle-tree-root', 'current-hash.json'),
    path.join(__dirname, '..', 'data', 'dapi-management-merkle-tree-root', 'current-hash.json'),
    path.join(__dirname, '..', 'data', 'dapi-pricing-merkle-tree-root', 'current-hash.json'),
  ];

  currentHashPaths.forEach((currentHashPath) => {
    const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));
    currentHashData.merkleTreeValues = {
      values: currentHashData.merkleTreeValues.values.map((values) => {
        values[0] = ethers.utils.formatBytes32String(values[0]);
        return values;
      }),
    };

    fs.writeFileSync(currentHashPath, JSON.stringify(currentHashData, null, 2));

    console.info('Current hash file updated.');
  });

  exec('yarn format');
}
syncDapiFallbackValues().catch((error) => {
  console.error(`Error processing dapi fallback sync:`, error);
  process.exit(1);
});

module.exports = { syncDapiFallbackValues };
