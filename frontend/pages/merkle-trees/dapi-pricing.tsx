import { z } from 'zod';
import RootLayout from '~/components/root-layout';
import { TreeStatusBadge, TreeRootBadge, SignatureTable, SignRootButton } from '~/components/merkle-tree-elements';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { readSignerDataFrom, readTreeDataFrom } from '~/lib/server/file-utils';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
});

export async function getServerSideProps() {
  const subfolder = 'dapi-pricing-merkle-tree-root';

  const { data: currentTree } = readTreeDataFrom({
    subfolder,
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });

  const { data: signers } = readSignerDataFrom(subfolder);

  return {
    props: { currentTree, signers },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiPricingTree(props: Props) {
  const { currentTree, signers } = props;
  const { signRoot, isSigning } = useTreeSigner('dAPI pricing Merkle tree', currentTree.hash, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI pricing Merkle tree root',
    currentTree.hash,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  return (
    <RootLayout>
      <div>
        <TreeStatusBadge signatures={signatures} />
      </div>
      <h1 className="mb-2 text-3xl font-bold">dAPI Pricing Merkle Tree</h1>
      <TreeRootBadge className="mb-3" root={currentTree.hash} />

      <div className="mb-10">
        <SignRootButton signatures={signatures} signRoot={signRoot} isSigning={isSigning} />
      </div>

      <div className="mb-10">
        <SignatureTable signers={signers} signatures={signatures} />
      </div>
      <div className="flex justify-center text-lg text-gray-400">
        dAPI Pricing merkle tree data has been hidden due to its size
      </div>
    </RootLayout>
  );
}
