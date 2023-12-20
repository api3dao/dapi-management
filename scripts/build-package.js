const fs = require('fs');

const PRICING_MT_PATH = './data/dapi-pricing-merkle-tree-root/current-hash.json';

const OUTPUT_DIR = './src/generated';
const SUPPORTED_CHAIN_IDS_PATH = `${OUTPUT_DIR}/supported-chains.json`;

// export the supported chain IDs from the pricing merkle tree
const data = fs.readFileSync(PRICING_MT_PATH, 'utf8');
const jsonData = JSON.parse(data);
const chainIds = jsonData.merkleTreeValues.map(value => value[1]);
const uniqueChainIds = [...new Set(chainIds)];

fs.writeFileSync(SUPPORTED_CHAIN_IDS_PATH, JSON.stringify(uniqueChainIds, null, 2));

