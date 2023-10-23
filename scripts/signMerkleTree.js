const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const mnemonic = process.env.MNEMONIC;
const wallet = ethers.Wallet.fromMnemonic(mnemonic);

const merkleType = process.argv[2];
const chainIdArg = process.argv[3];

// Validate the provided Merkle type
if (
  !merkleType ||
  ![
    'Price merkle tree root',
    'dAPI management merkle tree root',
    'dAPI fallback merkle tree root',
    'API integration merkle tree root',
  ].includes(merkleType)
) {
  console.error('You must provide a valid Merkle type as an argument!');
  process.exit(1);
}

// Validate and parse the provided chainId
if (!chainIdArg || isNaN(parseInt(chainIdArg))) {
  console.error('You must provide a valid chainId as an argument!');
  process.exit(1);
}
const chainId = parseInt(chainIdArg);

// Define the domain structure for EIP-712 signing
const domain = {
  name: 'HashRegistry',
  version: '1.0.0',
  chainId: chainId,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// Define the data structure of the message to be signed
const types = {
  SignedHash: [
    { name: 'hashType', type: 'bytes32' },
    { name: 'hash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

// Function to sign an EIP-712 compliant message
async function signEIP712Message(hashType, hash, timestamp) {
  const message = {
    hashType: hashType,
    hash: hash,
    timestamp: timestamp,
  };

  const signature = await wallet._signTypedData(domain, types, message);
  return signature;
}

// Function to construct a Merkle tree from provided values and data types
function constructMerkleTree(values, dataTypes) {
  return StandardMerkleTree.of(values, dataTypes);
}

// Predefined data types for each Merkle tree
const HASH_TYPE_DATA_TYPES = {
  'Price merkle tree root': ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256'],
  'dAPI management merkle tree root': ['bytes32', 'bytes32', 'address'],
  'dAPI fallback merkle tree root': ['bytes32', 'bytes32', 'address'],
  'API integration merkle tree root': ['address', 'bytes32'],
};

// Function to sign a specific Merkle tree defined by its name
async function signMerkleTree(merkleTreeName) {
  // Define path and read metadata.json
  const metadataPath = path.join(__dirname, '..', 'data', 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  // Extract relevant data for the specified Merkle tree
  const treeData = metadata.merkleTrees[merkleTreeName];
  const values = treeData.values;

  const dataTypes = HASH_TYPE_DATA_TYPES[merkleTreeName];
  if (!dataTypes) {
    throw new Error(`Data type for ${merkleTreeName} not found`);
  }

  // Construct the Merkle tree and derive its root
  const tree = constructMerkleTree(values, dataTypes);
  const merkleRoot = tree.root;

  // Derive hashType from the merkle tree's name
  const hashType = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(merkleTreeName));

  // Get the timestamp from metadata.json
  const timestamp = treeData.timestamp;

  // Validate timestamp existence
  if (!timestamp) {
    throw new Error('Timestamp not provided in metadata');
  }

  // Generate the signature for the tree
  const signature = await signEIP712Message(hashType, merkleRoot, timestamp);
  const signerAddress = ethers.Wallet.fromMnemonic(process.env.MNEMONIC).address;

  // Update the metadata file with the signature and merkle root
  treeData.merkleRoot = merkleRoot;
  treeData.signatures = treeData.signatures || {};
  treeData.signatures[signerAddress] = signature;

  // Write the updated metadata back to the file
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4));
}

// Sign the Merkle tree
signMerkleTree(merkleType).catch((error) => {
  console.error(`Error processing ${merkleType}:`, error);
});
