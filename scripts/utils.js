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

module.exports = {
  createDapiFallbackMerkleTree,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createSignedApiUrlMerkleTree,
};
