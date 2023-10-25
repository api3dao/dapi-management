const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const mnemonic = process.env.MNEMONIC;
const wallet = ethers.Wallet.fromMnemonic(mnemonic);

const merkleType = process.argv[2];
const chainIdArg = process.argv[3];

const MERKLE_TREE_MAPPING = {
    'price': 'dapi-pricing-merkle-tree-root',
    'dapi management': 'dapi-management-merkle-tree-root',
    'dapi fallback': 'dapi-fallback-merkle-tree-root',
    'api integration': 'signed-api-url-merkle-tree-root',
};

if (!MERKLE_TREE_MAPPING[merkleType]) {
    console.error('You must provide a valid Merkle type as an argument!');
    process.exit(1);
}

if (!chainIdArg || isNaN(parseInt(chainIdArg))) {
    console.error('You must provide a valid chainId as an argument!');
    process.exit(1);
}
const chainId = parseInt(chainIdArg);

const domain = {
    name: 'HashRegistry',
    version: '1.0.0',
    chainId: chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000',
};

const types = {
    SignedHash: [
        { name: 'hashType', type: 'bytes32' },
        { name: 'hash', type: 'bytes32' },
        { name: 'timestamp', type: 'uint256' },
    ],
};

async function signEIP712Message(hashType, hash, timestamp) {
    const message = {
        hashType: hashType,
        hash: hash,
        timestamp: timestamp,
    };

    const signature = await wallet._signTypedData(domain, types, message);
    return signature;
}

function constructMerkleTree(values, dataTypes) {
    return StandardMerkleTree.of(values, dataTypes);
}

const HASH_TYPE_DATA_TYPES = {
    'price': ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256'],
    'dapi management': ['bytes32', 'bytes32', 'address'],
    'dapi fallback': ['bytes32', 'bytes32', 'address'],
    'api integration': ['address', 'bytes32'],
};

async function signMerkleTree(merkleTreeName) {
  const folderName = MERKLE_TREE_MAPPING[merkleTreeName];
  const currentHashPath = path.join(__dirname, '..', 'data', folderName, 'current-hash.json');

  let currentHashData = { signatures: {}, merkleTreeValues: { values: [] } };

  if (fs.existsSync(currentHashPath)) {
      const currentHashRawData = fs.readFileSync(currentHashPath, 'utf8');
      currentHashData = JSON.parse(currentHashRawData);
  }

  const values = currentHashData.merkleTreeValues ? currentHashData.merkleTreeValues.values : [];
  const timestamp = currentHashData.timestamp ? currentHashData.timestamp : 0;

  const dataTypes = HASH_TYPE_DATA_TYPES[merkleTreeName];
  if (!dataTypes) {
      throw new Error(`Data type for ${merkleTreeName} not found`);
  }
  const tree = constructMerkleTree(values, dataTypes);
  const merkleRoot = tree.root;

  const hashType = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(merkleTreeName));

  const signature = await signEIP712Message(hashType, merkleRoot, timestamp);
  const signerAddress = wallet.address;

  currentHashData = {
    timestamp: timestamp,
      hash: merkleRoot,
      signatures: {
          ...currentHashData.signatures,
          [signerAddress]: signature
      },
      merkleTreeValues: { values: values },
  };

  fs.writeFileSync(currentHashPath, JSON.stringify(currentHashData, null, 4));
}

signMerkleTree(merkleType).catch((error) => {
  console.error(`Error processing ${merkleType}:`, error);
  process.exit(1);
});

module.exports = { signEIP712Message, constructMerkleTree };