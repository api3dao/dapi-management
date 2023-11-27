const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
} = require('./utils');
require('dotenv').config();

// Merkle tree names
const DAPI_FALLBACK_TREE = 'dAPI fallback Merkle tree';
const DAPI_MANAGEMENT_TREE = 'dAPI management Merkle tree';
const DAPI_PRICING_TREE = 'dAPI pricing Merkle tree';
const SIGNED_API_URL_TREE = 'Signed API URL Merkle tree';

const mnemonic = process.env.MNEMONIC;
const wallet = ethers.Wallet.fromMnemonic(mnemonic);

const merkleTreeName = process.argv[2];

const MERKLE_TREE_MAPPING = {
  [DAPI_FALLBACK_TREE]: ['dapi-fallback-merkle-tree-root', createDapiFallbackMerkleTree],
  [DAPI_MANAGEMENT_TREE]: ['dapi-management-merkle-tree-root', createDapiManagementMerkleTree],
  [DAPI_PRICING_TREE]: ['dapi-pricing-merkle-tree-root', createDapiPricingMerkleTree],
  [SIGNED_API_URL_TREE]: ['signed-api-url-merkle-tree-root', createSignedApiUrlMerkleTree],
};

if (!MERKLE_TREE_MAPPING[merkleTreeName]) {
  console.error('You must provide a valid Merkle tree name as an argument!');
  process.exit(1);
}

async function signMerkleTree(merkleTreeName) {
  const [folderName, createMerkleTree] = MERKLE_TREE_MAPPING[merkleTreeName];
  const currentHashPath = path.join(__dirname, '..', 'data', folderName, 'current-hash.json');
  const signersPath = path.join(__dirname, '..', 'data', folderName, 'hash-signers.json');
  const currentHashData = JSON.parse(fs.readFileSync(currentHashPath, 'utf8'));
  const signerData = JSON.parse(fs.readFileSync(signersPath, 'utf8'));

  const signerAddress = wallet.address;
  if (!signerData.hashSigners.includes(signerAddress)) {
    throw new Error(`${signerAddress} is not a root signer`);
  }

  const values = currentHashData.merkleTreeValues ? currentHashData.merkleTreeValues.values : [];
  const timestamp = currentHashData.timestamp ? currentHashData.timestamp : 0;

  const tree = createMerkleTree(values);
  const merkleRoot = tree.root;

  const treeHash = deriveTreeHash(merkleTreeName, merkleRoot, timestamp);
  const signature = await wallet.signMessage(treeHash);

  const updatedHashData = {
    ...currentHashData,
    signatures: validateSignatures(
      treeHash,
      { ...currentHashData.signatures, [signerAddress]: signature },
      signerData.hashSigners
    ),
  };

  fs.writeFileSync(currentHashPath, JSON.stringify(updatedHashData, null, 2));
  exec('yarn format');
}

function deriveTreeHash(treeName, treeRoot, timestamp) {
  const hashType = ethers.utils.solidityKeccak256(['string'], [`${treeName} root`]);

  return ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [hashType, treeRoot, timestamp])
  );
}

function validateSignatures(treeHash, signatures, signers) {
  return signers.reduce((acc, signer) => {
    const signature = signatures[signer];

    try {
      if (signer === ethers.utils.verifyMessage(treeHash, signature)) {
        acc[signer] = signature;
        return acc;
      }
    } catch {
      // Do nothing
    }

    acc[signer] = '0x';
    return acc;
  }, {});
}

signMerkleTree(merkleTreeName).catch((error) => {
  console.error(`Error processing "${merkleTreeName}":`, error);
  process.exit(1);
});

module.exports = { signMerkleTree };
