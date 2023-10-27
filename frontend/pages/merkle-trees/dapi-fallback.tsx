import { join } from 'path';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import z from 'zod';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import RootLayout from '~/components/root-layout';
import SignatureTable from '~/components/signature-table';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
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
      <h1 className="mb-1 text-4xl font-bold">dAPI Fallback Merkle Tree</h1>

      <div className="mb-10">
        <p className="inline-block whitespace-nowrap break-words rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-900">
          Root: {merkleTree.root}
        </p>
        {address && !isSigner && (
          <div>
            <p className="mt-2 inline-block whitespace-nowrap break-words rounded-md bg-amber-50 px-3 py-1 text-sm text-amber-700">
              You are not a signer of this tree.
            </p>
          </div>
        )}
        <Button disabled={!canSign} className="mt-2 block min-w-[15ch]">
          Sign Root
        </Button>
      </div>

      <section className="mb-10">
        <SignatureTable signatures={signatures} />
      </section>

      <section>
        <h3 className="mb-3 font-bold">Merkle Tree Values</h3>
        <Table className="text-s">
          <TableHeader>
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
