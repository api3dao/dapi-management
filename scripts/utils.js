const { ethers } = require('ethers');

const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');

function createDapiFallbackMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'bytes32', 'address']);
}

function createDapiManagementMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'bytes32', 'address']);
}

function createDapiPricingMerkleTree(values) {
  return StandardMerkleTree.of(values, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

function createSignedApiUrlMerkleTree(values) {
  return StandardMerkleTree.of(values, ['address', 'bytes32']);
}

function getDapiFallbackHashType() {
  return ethers.utils.solidityKeccak256(['string'], ['dAPI fallback Merkle tree root']);
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

module.exports = {
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
  getDapiFallbackHashType,
  getDapiManagementHashType,
  getDapiPricingHashType,
  getSignedApiUrlHashType,
};
