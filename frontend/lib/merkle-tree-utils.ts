import { ethers } from 'ethers';

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
