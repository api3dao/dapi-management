import { z } from 'zod';
import round from 'lodash/round';
import { CHAINS } from '@api3/chains';
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
import { readTreeDataFrom, readSignerDataFrom, createTreeDiff } from '~/lib/server/file-utils';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { useState } from 'react';
import { ethers } from 'ethers';

type Unit = 'wei' | 'ether';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()])),
  }),
});

export async function getServerSideProps() {
  const { data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-pricing-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: previousTree } = readTreeDataFrom({
    subfolder: 'dapi-pricing-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-pricing-merkle-tree-root');

  const diffResult = previousTree
    ? await createTreeDiff({
        subfolder: 'dapi-pricing-merkle-tree-root',
        previousData: previousTree,
        currentData: currentTree,
        preProcessor: (values) => {
          return [
            ethers.utils.parseBytes32String(values[0]),
            getChainAlias(values[1]),
            formatUpdateParams(values[2]),
            formatDuration(values[3]),
            ethers.utils.commify(ethers.utils.formatEther(values[4])),
          ];
        },
      })
    : null;

  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiPricingTree(props: Props) {
  const { currentTree, signers } = props;
  const [priceUnit, setPriceUnit] = useState<Unit>('ether');

  const { signRoot, isSigning } = useTreeSigner('dAPI pricing Merkle tree', currentTree.hash, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI pricing Merkle tree root',
    currentTree.hash,
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
      <TreeRootBadge className="mb-3" root={currentTree.hash} />

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
                <TableHead>Duration (Days)</TableHead>
                <TableHead>
                  Price
                  <Select value={priceUnit} onValueChange={(unit: Unit) => setPriceUnit(unit)}>
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
                  <TableCell>{ethers.utils.parseBytes32String(pricing[0])}</TableCell>
                  <TableCell>{getChainAlias(pricing[1])}</TableCell>
                  <TableCell>{formatUpdateParams(pricing[2])}</TableCell>
                  <TableCell>{formatDuration(pricing[3])}</TableCell>
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

function formatUpdateParams(text: string) {
  const decodedResults = ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], text);
  const joinedResults = decodedResults.map((e) => e.toString()).join(', ');
  return `(${joinedResults})`;
}

function formatDuration(seconds: string) {
  return round(parseInt(seconds, 10) / 24 / 60 / 60, 2).toString();
}

let aliases: Record<string, string>;
function getChainAlias(chainId: string) {
  if (!aliases) {
    aliases = CHAINS.reduce((acc, chain) => {
      acc[chain.id] = chain.alias;
      return acc;
    }, {} as Record<string, string>);
  }

  return aliases[chainId] || chainId;
}
