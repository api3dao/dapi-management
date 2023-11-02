import { promisify } from 'util';
import { exec } from 'child_process';
import { ethers } from 'ethers';
import { z } from 'zod';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BadgeInfoIcon } from 'lucide-react';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Button } from '~/components/ui/button';
import { TreeStatusBadge, TreeRootBadge, SignatureTable, TreeDiff } from '~/components/merkle-tree-elements';
import { useWeb3Data } from '~/contexts/web3-data-context';
import { readTreeDataFrom, readSignerDataFrom } from '~/lib/server/file-utils';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';

const execute = promisify(exec);

const merkleTreeSchema = z.object({
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

  let treeDiff = '';
  if (previousTree) {
    const result = await execute(`git diff --no-index ${previousTreePath} ${currentTreePath} | cat`);
    treeDiff = result.stdout;
  }

  return {
    props: { currentTree, signers, treeDiff },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiFallbackTree(props: Props) {
  const { currentTree, signers } = props;
  const { address } = useWeb3Data();

  const merkleTree = StandardMerkleTree.of(currentTree.merkleTreeValues.values, ['bytes32', 'bytes32', 'address']);
  const merkleTreeRoot = ethers.utils.arrayify(merkleTree.root);
  const signatures = validateTreeRootSignatures(merkleTreeRoot, currentTree.signatures, signers);

  const isSigner = !!signatures[address];
  const canSign = signatures[address] === '0x';

  return (
    <RootLayout>
      <div>
        <TreeStatusBadge signatures={signatures} />
      </div>
      <h1 className="mb-2 text-3xl font-bold">dAPI Fallback Merkle Tree</h1>
      <TreeRootBadge className="mb-3" root={merkleTree.root} />

      <div className="mb-10">
        <div className="flex gap-3">
          <Button disabled={!canSign} className="min-w-[15ch]">
            Sign Root
          </Button>
        </div>
        {!!address && !isSigner && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
            <BadgeInfoIcon className="w-4 text-gray-300" />
            You are not a signer.
          </p>
        )}
      </div>

      <div className="mb-10">
        <SignatureTable signers={signers} signatures={signatures} />
      </div>

      <Tabs defaultValue="mt-values">
        <TabsList>
          <TabsTrigger value="mt-values">Tree Values</TabsTrigger>
          <TabsTrigger value="mt-diff">Tree Diff</TabsTrigger>
        </TabsList>
        <TabsContent value="mt-values">
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead className="w-[15ch] whitespace-nowrap">dAPI Name</TableHead>
                <TableHead>Beacon ID</TableHead>
                <TableHead>Sponsor Wallet Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentTree.merkleTreeValues.values.map((fallback, i) => (
                <TableRow key={i}>
                  <TableCell>{ethers.utils.parseBytes32String(fallback[0])}</TableCell>
                  <TableCell>{fallback[1]}</TableCell>
                  <TableCell>{fallback[2]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="mt-diff" forceMount>
          <TreeDiff diff={props.treeDiff} />
        </TabsContent>
      </Tabs>
    </RootLayout>
  );
}
