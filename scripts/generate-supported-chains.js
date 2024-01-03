const fs = require('fs');
const { execSync } = require('child_process');
const { CHAINS } = require('@api3/chains');

const SUPPORTED_CHAINS_PATH = `./src/generated/supported-chains.json`;

// export the supported chain IDs from the pricing merkle tree
const currentHashData = require('../data/dapi-pricing-merkle-tree-root/current-hash.json');
const chainIds = currentHashData.merkleTreeValues.map((value) => value[1]);
const uniqueChainIds = [...new Set(chainIds)];
const chainNames = uniqueChainIds.map((chainId) => CHAINS.find((chain) => chain.id === chainId).alias);

fs.writeFileSync(SUPPORTED_CHAINS_PATH, JSON.stringify(chainNames, null, 2));
execSync('yarn format');
