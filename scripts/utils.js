const { ethers } = require('ethers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const {
  getAirnodeAddressByAlias,
  deriveDataFeedId: deriveDataFeedIdWithAirnodeAddress,
} = require('@api3/api-integrations');
const { deriveWalletPathFromSponsorAddress } = require('@api3/airnode-node/dist/src/evm');
const { airseekerXPub } = require('../data/airseeker.json');

function createDapiManagementMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'bytes32', 'address']);
}

function createDapiPricingMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

function createSignedApiUrlMerkleTree(values) {
  return StandardMerkleTree.of(values, ['address', 'string']);
}

function deriveTreeHash(hashType, treeRoot, timestamp) {
  return ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [hashType, treeRoot, timestamp])
  );
}

function getDapiManagementHashType() {
  return ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
}
function getDapiPricingHashType() {
  return ethers.utils.solidityKeccak256(['string'], ['dAPI pricing Merkle tree root']);
}
function getSignedApiUrlHashType() {
  return ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle tree root']);
}

function deriveDataFeedId(dapiName, apiProviders) {
  if (apiProviders.length === 1) {
    if (apiProviders[0] !== 'nodary') {
      throw new Error('If dAPI has only one provider, it must be Nodary.');
    }

    const airnodeAddress = getAirnodeAddressByAlias(apiProviders[0]);
    return deriveDataFeedIdWithAirnodeAddress(dapiName, airnodeAddress);
  }

  return deriveBeaconSetId(dapiName, apiProviders);
}

function deriveBeaconSetId(dataFeedName, apiProviders) {
  const dataFeedIds = apiProviders.map((apiAlias) => {
    const airnodeAddress = getAirnodeAddressByAlias(apiAlias);
    return deriveDataFeedIdWithAirnodeAddress(dataFeedName, airnodeAddress);
  });
  return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [dataFeedIds]));
}

const PROTOCOL_ID_AIRSEEKER = '5';
function deriveSponsorWalletAddress(dapiNameInBytes32) {
  const hashedDapiName = ethers.utils.keccak256(dapiNameInBytes32);
  const sponsorAddress = ethers.utils.getAddress(hashedDapiName.slice(0, 42));
  const airnodeHdNode = ethers.utils.HDNode.fromExtendedKey(airseekerXPub);
  return airnodeHdNode.derivePath(deriveWalletPathFromSponsorAddress(sponsorAddress, PROTOCOL_ID_AIRSEEKER)).address;
}

module.exports = {
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
  deriveTreeHash,
  getDapiManagementHashType,
  getDapiPricingHashType,
  getSignedApiUrlHashType,
  deriveDataFeedId,
  deriveBeaconSetId,
  deriveSponsorWalletAddress,
};
