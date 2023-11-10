import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

export function validateTreeRootSignatures(root: Uint8Array, signatures: Record<string, string>, signers: string[]) {
  return signers.reduce((acc, signer) => {
    const signature = signatures[signer];

    try {
      if (signer === ethers.utils.verifyMessage(root, signature)) {
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
  return StandardMerkleTree.of(values, ['bytes32', 'bytes32', 'address']);
}

export function createDapiPricingMerkleTree(values: string[][]) {
  return StandardMerkleTree.of(values, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
}

export function createSignedApiUrlMerkleTree(values: string[][]) {
  return StandardMerkleTree.of(values, ['address', 'bytes32']);
}
