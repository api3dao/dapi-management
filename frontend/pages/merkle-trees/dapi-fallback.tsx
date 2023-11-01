import { ethers } from 'ethers';
import { z } from 'zod';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BadgeInfoIcon } from 'lucide-react';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { TreeStatusBadge, TreeRootBadge, SignatureTable } from '~/components/merkle-tree-elements';
import { useWeb3Data } from '~/contexts/web3-data-context';
import { readTreeDataFrom, readSignerDataFrom } from '~/lib/server/file-utils';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';

const merkleTreeSchema = z.object({
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string()])),
  }),
});

export function getServerSideProps() {
  const { data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-fallback-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-fallback-merkle-tree-root');

  return {
    props: { currentTree, signers },
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
          <Button variant="outline">View Tree Diff</Button>
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

      <section>
        <h3 className="mb-3 font-medium">Merkle Tree Values</h3>
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead className="whitespace-nowrap">dAPI Name</TableHead>
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
      </section>
    </RootLayout>
  );
}
