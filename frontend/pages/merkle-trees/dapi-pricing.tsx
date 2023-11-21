import { z } from 'zod';
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
import { createDapiPricingMerkleTree, validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { useState } from 'react';
import { ethers } from 'ethers';

type Unit = 'wei' | 'ether';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()])),
  }),
});

export async function getServerSideProps() {
  const { path: currentTreePath, data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-pricing-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { path: previousTreePath, data: previousTree } = readTreeDataFrom({
    subfolder: 'dapi-pricing-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-pricing-merkle-tree-root');

  const diffResult = previousTree ? await createFileDiff(previousTreePath, currentTreePath) : null;
  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiPricingTree(props: Props) {
  const { currentTree, signers } = props;
  const [priceUnit, setPriceUnit] = useState<Unit>('ether');

  const merkleTree = createDapiPricingMerkleTree(currentTree.merkleTreeValues.values);

  const { signRoot, isSigning } = useTreeSigner('dAPI pricing Merkle tree', merkleTree.root, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI pricing Merkle tree root',
    merkleTree.root,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  const convertPrice = (price: string) => {
    return priceUnit === 'ether' ? ethers.utils.commify(ethers.utils.formatEther(price)) : price;
  };

  return (
    <RootLayout>
      <div>
        <TreeStatusBadge signatures={signatures} />
      </div>
      <h1 className="mb-2 text-3xl font-bold">dAPI Pricing Merkle Tree</h1>
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
                <TableHead>Chain ID</TableHead>
                <TableHead>dAPI Update Parameters</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>
                  Price
                  <Select onValueChange={(unit: Unit) => setPriceUnit(unit)} defaultValue="ether">
                    <SelectTrigger className="ml-1 inline-flex h-8 w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ether">Ether</SelectItem>
                      <SelectItem value="wei">Wei</SelectItem>
                    </SelectContent>
                  </Select>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentTree.merkleTreeValues.values.map((pricing, i) => (
                <TableRow key={i}>
                  <TableCell>{pricing[0]}</TableCell>
                  <TableCell>{pricing[1]}</TableCell>
                  <TableCell>{pricing[2]}</TableCell>
                  <TableCell>{pricing[3]}</TableCell>
                  <TableCell>{convertPrice(pricing[4])}</TableCell>
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
