import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

export function validateTreeRootSignatures(
  rawHashType: RawHashType,
  root: string,
  timestamp: number,
  signatures: Record<string, string>,
  signers: string[]
) {
  const hash = deriveTreeHash(rawHashType, root, timestamp);
  return signers.reduce((acc, signer) => {
    const signature = signatures[signer];

    try {
      if (signer === ethers.utils.verifyMessage(hash, signature)) {
        acc[signer] = signature;
        return acc;
      }
    } catch {
      // Do nothing
    }

    acc[signer] = '0x';
    return acc;
  }, {} as Record<string, string>);
}

export function createDapiFallbackMerkleTree(values: string[][]) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

export function createDapiManagementMerkleTree(values: string[][]) {
  const formattedValues = values.map((value) => [ethers.utils.formatBytes32String(value[0]), value[1], value[2]]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'bytes32', 'address']);
}

export function createDapiPricingMerkleTree(values: string[][]) {
  const formattedValues = values.map((value) => [
    ethers.utils.formatBytes32String(value[0]),
    value[1],
    value[2],
    value[3],
    value[4],
  ]);
  return StandardMerkleTree.of(formattedValues, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

export function createSignedApiUrlMerkleTree(values: string[][]) {
  return StandardMerkleTree.of(values, ['address', 'bytes32']);
}

export const DAPI_FALLBACK_MERKLE_TREE_TYPE = 'dAPI fallback Merkle tree';
export const DAPI_PRICING_MERKLE_TREE_TYPE = 'dAPI pricing Merkle tree';
export const DAPI_MANAGEMENT_MERKLE_TREE_TYPE = 'dAPI management Merkle tree';
export const SIGNED_API_URL_MERKLE_TREE_TYPE = 'Signed API URL Merkle tree';

export type TreeType =
  | typeof DAPI_FALLBACK_MERKLE_TREE_TYPE
  | typeof DAPI_PRICING_MERKLE_TREE_TYPE
  | typeof DAPI_MANAGEMENT_MERKLE_TREE_TYPE
  | typeof SIGNED_API_URL_MERKLE_TREE_TYPE;

export type RawHashType = `${TreeType} root`;

export const deriveTreeHash = (rawHashType: RawHashType, treeRoot: string, timestamp: number) => {
  const encodedHash = ethers.utils.toUtf8Bytes(rawHashType);
  const hashType = ethers.utils.keccak256(encodedHash);

  const encodedValues = ethers.utils.defaultAbiCoder.encode(
    ['string', 'bytes32', 'uint256'],
    [hashType, treeRoot, timestamp]
  );

  // Hash the encoded parameters
  const hash = ethers.utils.keccak256(encodedValues);

  return ethers.utils.arrayify(hash);
};
