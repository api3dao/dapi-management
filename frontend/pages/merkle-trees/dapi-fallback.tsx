import { join } from 'path';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import z from 'zod';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BadgeInfoIcon } from 'lucide-react';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { TreeStatusBadge, TreeRootBadge, SignatureTable } from '~/components/merkle-tree-elements';
import { useWeb3Data } from '~/contexts/web3-data-context';
import { InferGetServerSidePropsType } from 'next';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string()])),
  }),
});

const signersSchema = z.object({
  hashSigners: z.array(z.string()),
});

export function getServerSideProps() {
  const currentTreePath = join(process.cwd(), '../data/dapi-fallback-merkle-tree-root/current-hash.json');
  const signersPath = join(process.cwd(), '../data/dapi-fallback-merkle-tree-root/hash-signers.json');
  const currentTree = JSON.parse(readFileSync(currentTreePath, 'utf8'));
  const signers = JSON.parse(readFileSync(signersPath, 'utf8'));

  return {
    props: {
      currentTree: merkleTreeSchema.parse(currentTree),
      signers: signersSchema.parse(signers).hashSigners,
    },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiFallbackTree(props: Props) {
  const { currentTree, signers } = props;
  const { address } = useWeb3Data();

  const merkleTree = StandardMerkleTree.of(currentTree.merkleTreeValues.values, ['bytes32', 'bytes32', 'address']);
  const merkleTreeRoot = ethers.utils.arrayify(merkleTree.root);
  const signatures = validateSignatures(merkleTreeRoot, currentTree.signatures, signers);

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
        <SignatureTable signatures={signatures} />
      </div>

      <section>
        <h3 className="mb-3 font-medium">Merkle Tree Values</h3>
        <Table className="text-s">
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

function validateSignatures(root: Uint8Array, signatures: Record<string, string>, signers: string[]) {
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
