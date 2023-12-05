import { useState } from 'react';
import { BigNumber, ethers } from 'ethers';
import { z } from 'zod';
import round from 'lodash/round';
import { CHAINS } from '@api3/chains';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import {
  TreeStatusBadge,
  TreeRootBadge,
  SignatureTable,
  TreeDiff,
  SignRootButton,
  ViewOptionsMenu,
} from '~/components/merkle-tree-elements';
import { getMerkleTreeServerSideProps } from '~/lib/server/page-props';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { GetServerSidePropsContext, InferGetServerSidePropsType } from 'next';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { useDiffMode } from '~/components/merkle-tree-elements/use-diff-mode';
import ScrollToTopWrapper from '~/components/ui/srollToTopWrapper';

type Unit = 'wei' | 'ether';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()])),
});

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const showRawValues = context.query.raw === 'true';

  const { currentTree, signers, diffResult } = await getMerkleTreeServerSideProps({
    subfolder: 'dapi-pricing-merkle-tree-root',
    schema: merkleTreeSchema,
    diff: {
      preProcess: !showRawValues,
      preProcessor: (values) => {
        return [
          ethers.utils.parseBytes32String(values[0]),
          getChainAlias(values[1]),
          formatUpdateParams(values[2]),
          formatDuration(values[3]),
          ethers.utils.commify(ethers.utils.formatEther(values[4])),
        ];
      },
    },
  });

  return {
    props: { currentTree, signers, diffResult, showRawValues },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiPricingTree(props: Props) {
  const { currentTree, signers, showRawValues } = props;
  const [priceUnit, setPriceUnit] = useState<Unit>('ether');

  const { signRoot, isSigning } = useTreeSigner('dAPI pricing Merkle tree', currentTree.hash, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI pricing Merkle tree root',
    currentTree.hash,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  const [diffMode, setDiffMode] = useDiffMode();

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
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="0">Tree Values</TabsTrigger>
            <TabsTrigger value="1">Tree Diff</TabsTrigger>
          </TabsList>
          <ViewOptionsMenu diffMode={diffMode} onDiffModeChange={setDiffMode} />
        </div>
        <ScrollToTopWrapper>
          <TabsContent value="0">
            {showRawValues ? (
              <RawValuesTable values={currentTree.merkleTreeValues} />
            ) : (
              <Table className="mt-4">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>dAPI Name</TableHead>
                    <TableHead>Chain</TableHead>
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
                  {currentTree.merkleTreeValues.slice(0, 100).map((pricing, i) => (
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
            )}
          </TabsContent>
          <TabsContent value="1" forceMount>
            <TreeDiff diffResult={props.diffResult} diffMode={diffMode} raw={showRawValues} />
          </TabsContent>
        </ScrollToTopWrapper>
      </Tabs>
    </RootLayout>
  );
}

interface RawValuesTableProps {
  values: string[][];
}

function RawValuesTable(props: RawValuesTableProps) {
  return (
    <Table className="mt-4">
      <TableHeader sticky>
        <TableRow>
          <TableHead>dAPI Name</TableHead>
          <TableHead className="whitespace-nowrap">Chain ID</TableHead>
          <TableHead>dAPI Update Parameters</TableHead>
          <TableHead>Duration (Seconds)</TableHead>
          <TableHead>Price (Wei)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.values.map((pricing, i) => (
          <TableRow key={i}>
            <TableCell>{pricing[0]}</TableCell>
            <TableCell>{pricing[1]}</TableCell>
            <TableCell>{pricing[2]}</TableCell>
            <TableCell>{pricing[3]}</TableCell>
            <TableCell>{pricing[4]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatUpdateParams(text: string) {
  const decodedResults = ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], text) as [
    BigNumber,
    BigNumber,
    number
  ];

  const deviation = round(decodedResults[0].toNumber() / 1e8, 3) + '%';
  const devReference = decodedResults[1].eq(0) ? null : decodedResults[1].toString();
  const heartbeat = round(decodedResults[2] / 60 / 60, 2) + 'hrs';

  return devReference ? `${deviation}, ${devReference}, ${heartbeat}` : `${deviation}, ${heartbeat}`;
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
