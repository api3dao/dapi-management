const { ethers } = require('ethers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { getAirnodeAddressByAlias, deriveDataFeedId } = require('api-integrations');

function createDapiFallbackMerkleTree(values) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

function createDapiManagementMerkleTree(values) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

function createDapiPricingMerkleTree(values) {
  const formattedValues = values.map((value) => [
    ethers.utils.formatBytes32String(value[0]),
    value[1],
    value[2],
    value[3],
    value[4],
  ]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

function createSignedApiUrlMerkleTree(values) {
  return StandardMerkleTree.of(values, ['address', 'bytes32']);
}

function deriveBeaconSetId(dataFeedName, apiProviders) {
  const dataFeedIds = apiProviders.map((apiAlias) => {
    const airnodeAddress = getAirnodeAddressByAlias(apiAlias);
    return deriveDataFeedId(dataFeedName, airnodeAddress);
  });

  return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [dataFeedIds]));
}

module.exports = {
  deriveBeaconSetId,
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
};
