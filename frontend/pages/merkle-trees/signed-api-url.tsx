import { z } from 'zod';
import { getOisTitlesWithAirnodeAddress } from '@api3/api-integrations';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  PageHeading,
  TreeStatusBadge,
  TreeRootBadge,
  SignRootButton,
  SignatureTable,
  TreeDiff,
  ViewOptionsMenu,
} from '~/components/merkle-tree-elements';
import { getMerkleTreeServerSideProps } from '~/lib/server/page-props';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { GetServerSidePropsContext, InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { useDiffMode } from '~/components/merkle-tree-elements/use-diff-mode';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.array(z.tuple([z.string(), z.string()])),
});

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const showRawValues = context.query.raw === 'true';

  const { currentTree, signers, diffResult } = await getMerkleTreeServerSideProps({
    subfolder: 'signed-api-url-merkle-tree-root',
    schema: merkleTreeSchema,
    diff: {
      preProcess: !showRawValues,
      preProcessor: (values) => {
        return [getProviders(values[0]), values[1]];
      },
    },
  });

  return {
    props: { currentTree, signers, diffResult, showRawValues },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function SignedApiUrlTree(props: Props) {
  const { currentTree, signers, showRawValues } = props;

  const { signRoot, isSigning } = useTreeSigner('Signed API URL Merkle tree', currentTree.hash, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'Signed API URL Merkle tree root',
    currentTree.hash,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  const [diffMode, setDiffMode] = useDiffMode();

  return (
    <RootLayout>
      <TreeStatusBadge signatures={signatures} />
      <PageHeading>Signed API URL Merkle Tree</PageHeading>
      <TreeRootBadge className="mb-5" root={currentTree.hash} />

      <div className="mb-10">
        <SignRootButton signatures={signatures} signRoot={signRoot} isSigning={isSigning} />
      </div>

      <div className="mb-10">
        <SignatureTable signers={signers} signatures={signatures} />
      </div>

      <Tabs defaultValue="0">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="0">Tree Values</TabsTrigger>
            <TabsTrigger value="1">Tree Diff</TabsTrigger>
          </TabsList>
          <ViewOptionsMenu diffMode={diffMode} onDiffModeChange={setDiffMode} />
        </div>
        <TabsContent value="0">
          {showRawValues ? (
            <RawValuesTable values={currentTree.merkleTreeValues} />
          ) : (
            <Table className="mt-4 table-fixed">
              <TableHeader sticky>
                <TableRow>
                  <TableHead>API Providers</TableHead>
                  <TableHead>Signed API URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentTree.merkleTreeValues.map((rowValues, i) => (
                  <TableRow key={i}>
                    <TableCell>{getProviders(rowValues[0])}</TableCell>
                    <TableCell>{rowValues[1]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
        <TabsContent value="1" forceMount>
          <TreeDiff diffResult={props.diffResult} diffMode={diffMode} raw={showRawValues} />
        </TabsContent>
      </Tabs>
    </RootLayout>
  );
}

interface RawValuesTableProps {
  values: string[][];
}

function RawValuesTable(props: RawValuesTableProps) {
  return (
    <Table className="mt-4 table-fixed">
      <TableHeader sticky>
        <TableRow>
          <TableHead>Airnode Address</TableHead>
          <TableHead>Signed API URL</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.values.map((rowValues, i) => (
          <TableRow key={i}>
            <TableCell>{rowValues[0]}</TableCell>
            <TableCell>{rowValues[1]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function getProviders(airnodeAddress: string) {
  return getOisTitlesWithAirnodeAddress(airnodeAddress)?.join(', ') || 'Unknown';
}
