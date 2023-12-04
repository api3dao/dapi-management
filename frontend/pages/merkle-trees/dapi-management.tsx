import { z } from 'zod';
import { ethers } from 'ethers';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  TreeStatusBadge,
  TreeRootBadge,
  SignatureTable,
  TreeDiff,
  SignRootButton,
} from '~/components/merkle-tree-elements';
import { readTreeDataFrom, readSignerDataFrom, createFileDiff } from '~/lib/server/file-utils';
import { createDapiManagementMerkleTree, validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.array(z.tuple([z.string(), z.string(), z.string()])),
});

export async function getServerSideProps() {
  const { path: currentTreePath, data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-management-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { path: previousTreePath, data: previousTree } = readTreeDataFrom({
    subfolder: 'dapi-management-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-management-merkle-tree-root');

  const diffResult = previousTree ? await createFileDiff(previousTreePath, currentTreePath) : null;
  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiManagementTree(props: Props) {
  const { currentTree, signers } = props;

  const merkleTree = createDapiManagementMerkleTree(currentTree.merkleTreeValues);

  const { signRoot, isSigning } = useTreeSigner('dAPI management Merkle tree', merkleTree.root, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI management Merkle tree root',
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
      <h1 className="mb-2 text-3xl font-bold">dAPI Management Merkle Tree</h1>
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
              {currentTree.merkleTreeValues.map((management, i) => (
                <TableRow key={i}>
                  <TableCell>{ethers.utils.parseBytes32String(management[0])}</TableCell>
                  <TableCell>{management[1]}</TableCell>
                  <TableCell>{management[2]}</TableCell>
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
