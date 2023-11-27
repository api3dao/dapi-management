const { ethers } = require('ethers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');

function createDapiFallbackMerkleTree(values) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

function createDapiManagementMerkleTree(values) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

function createDapiPricingMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

function createSignedApiUrlMerkleTree(values) {
  return StandardMerkleTree.of(values, ['address', 'bytes32']);
}

module.exports = {
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
};
