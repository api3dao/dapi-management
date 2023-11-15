import { useWeb3Data } from '~/contexts/web3-data-context';
import { TreeType, deriveTreeHash } from '~/lib/merkle-tree-utils';
import { useToast } from '../ui/toast/use-toast';
import { useState } from 'react';
import { go } from '@api3/promise-utils';
import router from 'next/router';

export function useTreeSigner(treeType: TreeType, merkleRoot: string, timestamp: number) {
  const { address, signer } = useWeb3Data();
  const { toast } = useToast();
  const [isSigning, setIsSigning] = useState(false);

  const signRoot = async () => {
    if (!signer || !address) return;

    setIsSigning(true);

    const treeHash = deriveTreeHash(`${treeType} root`, merkleRoot, timestamp);

    // Trigger metamask signature request
    const goSignature = await go(() => signer.signMessage(treeHash));

    if (goSignature.success) {
      // Save signature to the file
      const payload = { signature: goSignature.data, address, treeType };
      const goRes = await go(() => fetch('/api/sign-merkle-root', { method: 'POST', body: JSON.stringify(payload) }));

      if (goRes.success && goRes.data.status === 200) {
        router.replace(router.asPath); // reload to update signatures on the page
        toast({
          title: 'Success',
          description: 'Successfully signed tree root',
          duration: 3000,
          variant: 'success',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to sign tree root',
          duration: 3000,
          variant: 'destructive',
        });
      }
    }
    setIsSigning(false);
  };

  return { signRoot, isSigning };
}
