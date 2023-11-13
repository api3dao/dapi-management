import { z } from 'zod';
import { AlertTriangleIcon } from 'lucide-react';
import { go } from '@api3/promise-utils';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Button } from '~/components/ui/button';
import { TreeStatusBadge, TreeRootBadge, SignatureTable, TreeDiff } from '~/components/merkle-tree-elements';
import { useWeb3Data } from '~/contexts/web3-data-context';
import { readTreeDataFrom, readSignerDataFrom, createFileDiff } from '~/lib/server/file-utils';
import {
  DAPI_FALLBACK_MERKLE_TREE_TYPE,
  deriveTreeHash,
  createDapiFallbackMerkleTree,
  validateTreeRootSignatures,
} from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useState } from 'react';
import router from 'next/router';
import { useToast } from '~/components/ui/toast/use-toast';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string()])),
  }),
});

export async function getServerSideProps() {
  const { path: currentTreePath, data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-fallback-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { path: previousTreePath, data: previousTree } = readTreeDataFrom({
    subfolder: 'dapi-fallback-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-fallback-merkle-tree-root');

  const diffResult = previousTree ? await createFileDiff(previousTreePath, currentTreePath) : null;
  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiFallbackTree(props: Props) {
  const { toast } = useToast();
  const [isLoading, setLoading] = useState(false);
  const { currentTree, signers } = props;
  const { address, signer, connectStatus } = useWeb3Data();

  const treeRootHash = `${DAPI_FALLBACK_MERKLE_TREE_TYPE} root`;
  const merkleTree = createDapiFallbackMerkleTree(currentTree.merkleTreeValues.values);

  const signRoot = async () => {
    if (!signer || !address) return;

    setLoading(true);

    const treeHash = deriveTreeHash(treeRootHash, merkleTree.root, currentTree.timestamp);

    // Trigger metamask signature request
    const goSignature = await go(() => signer.signMessage(treeHash));

    if (goSignature.success) {
      // Save signature to the file
      const payload = { signature: goSignature.data, address, treeType: DAPI_FALLBACK_MERKLE_TREE_TYPE };
      const goRes = await go(() => fetch('/api/sign-merkle-root', { method: 'POST', body: JSON.stringify(payload) }));

      if (goRes.success && goRes.data.status === 200) {
        router.replace(router.asPath); // reload to update signatures on the page
        toast({
          title: 'Sign Tree Root',
          description: 'Successfully signed tree root',
          duration: 3000,
        });
      } else {
        toast({
          title: 'Sign Tree Root',
          description: 'Could not sign tree root',
          duration: 3000,
          variant: 'destructive',
        });
      }
    }
    setLoading(false);
  };

  const signatures = validateTreeRootSignatures(
    treeRootHash,
    merkleTree.root,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  console.log(connectStatus);

  const isSigner = !!signatures[address];
  const canSign = (signatures[address] === '0x' || !isLoading) && connectStatus === 'connected';

  return (
    <RootLayout>
      <div>
        <TreeStatusBadge signatures={signatures} />
      </div>
      <h1 className="mb-2 text-3xl font-bold">dAPI Fallback Merkle Tree</h1>
      <TreeRootBadge className="mb-3" root={merkleTree.root} />

      <div className="mb-10">
        <div className="flex gap-3">
          <Button disabled={!canSign} className="min-w-[15ch]" onClick={() => signRoot()}>
            Sign Root
          </Button>
        </div>
        {!!address && !isSigner && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
            <AlertTriangleIcon className="w-4 text-gray-300" />
            You are not a signer.
          </p>
        )}
      </div>

      <div className="mb-10">
        <SignatureTable signers={signers} signatures={signatures} />
      </div>

      <Tabs defaultValue="0">
        <TabsList>
          <TabsTrigger value="0">Tree Values</TabsTrigger>
          <TabsTrigger value="1">Tree Diff</TabsTrigger>
        </TabsList>
        <TabsContent value="0">
          <Table className="mt-4">
            <TableHeader sticky>
              <TableRow>
                <TableHead>dAPI Name</TableHead>
                <TableHead>Beacon ID</TableHead>
                <TableHead>Sponsor Wallet Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentTree.merkleTreeValues.values.map((fallback, i) => (
                <TableRow key={i}>
                  <TableCell>{fallback[0]}</TableCell>
                  <TableCell>{fallback[1]}</TableCell>
                  <TableCell>{fallback[2]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="1" forceMount>
          <TreeDiff diffResult={props.diffResult} />
        </TabsContent>
      </Tabs>
    </RootLayout>
  );
}
