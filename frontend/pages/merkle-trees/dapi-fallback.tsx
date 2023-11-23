import { z } from 'zod';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  TreeStatusBadge,
  TreeRootBadge,
  SignRootButton,
  SignatureTable,
  TreeDiff,
} from '~/components/merkle-tree-elements';
import { readTreeDataFrom, readSignerDataFrom, createFileDiff } from '~/lib/server/file-utils';
import { createDapiFallbackMerkleTree, validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';

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
  const { currentTree, signers } = props;

  const merkleTree = createDapiFallbackMerkleTree(currentTree.merkleTreeValues.values);

  const { signRoot, isSigning } = useTreeSigner('dAPI fallback Merkle tree', merkleTree.root, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI fallback Merkle tree root',
    merkleTree.root,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  return (
    <RootLayout>
      <div>
        <TreeStatusBadge signatures={signatures} />
      </div>
      <h1 className="mb-2 text-3xl font-bold">dAPI Fallback Merkle Tree</h1>
      <TreeRootBadge className="mb-3" root={merkleTree.root} />

      <div className="mb-10">
        <SignRootButton signatures={signatures} signRoot={signRoot} isSigning={isSigning} />
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
                <TableHead>Data Feed ID</TableHead>
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
