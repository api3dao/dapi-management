import { z } from 'zod';
import { getOisTitlesWithAirnodeAddress } from '@api3/api-integrations';
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
import { readTreeDataFrom, readSignerDataFrom, createTreeDiff } from '~/lib/server/file-utils';
import { createSignedApiUrlMerkleTree, validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string()])),
  }),
});

export async function getServerSideProps() {
  const { data: currentTree } = readTreeDataFrom({
    subfolder: 'signed-api-url-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: previousTree } = readTreeDataFrom({
    subfolder: 'signed-api-url-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('signed-api-url-merkle-tree-root');

  const diffResult = previousTree
    ? await createTreeDiff({
        subfolder: 'signed-api-url-merkle-tree-root',
        previousData: previousTree,
        currentData: currentTree,
        preProcessor: (values) => {
          return [getProviders(values[0]), values[0], values[1]];
        },
      })
    : null;

  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function SignedApiUrlTree(props: Props) {
  const { currentTree, signers } = props;

  const merkleTree = createSignedApiUrlMerkleTree(currentTree.merkleTreeValues.values);

  const { signRoot, isSigning } = useTreeSigner('Signed API URL Merkle tree', merkleTree.root, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'Signed API URL Merkle tree root',
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
      <h1 className="mb-2 text-3xl font-bold">Signed API URL Merkle Tree</h1>
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
                <TableHead>API Providers</TableHead>
                <TableHead>Airnode Address</TableHead>
                <TableHead>Signed API URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentTree.merkleTreeValues.values.map((rowValues, i) => (
                <TableRow key={i}>
                  <TableCell>{getProviders(rowValues[0])}</TableCell>
                  <TableCell>{rowValues[0]}</TableCell>
                  <TableCell>{rowValues[1]}</TableCell>
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

function getProviders(airnodeAddress: string) {
  return getOisTitlesWithAirnodeAddress(airnodeAddress)?.join(', ') || 'unknown';
}
