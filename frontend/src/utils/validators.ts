import { ethers } from 'ethers';

export const validateTreeRootSignatures = (root: Uint8Array, signatures: string[], signers: string[]) => {
  return signers.map((signer, index) => {
    try {
      if (signer === ethers.utils.verifyMessage(root, signatures[index])) {
        return signatures[index];
      }
    } catch {
      console.error('Failed to validate root signatures', { root, signer });
    }
    return '0x';
  });
};
