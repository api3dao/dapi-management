import { useEffect } from 'react';
import { z } from 'zod';
import { ethers } from 'ethers';
import { apisData } from '@api3/api-integrations';
import { CheckIcon } from 'lucide-react';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Button } from '~/components/ui/button';
import {
  TreeStatusBadge,
  TreeRootBadge,
  SignatureTable,
  SignRootButton,
  TreeDiff,
} from '~/components/merkle-tree-elements';
import { readTreeDataFrom, readSignerDataFrom, createTreeDiff } from '~/lib/server/file-utils';
import { createDapiManagementMerkleTree, validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { InferGetServerSidePropsType } from 'next';
import { useToast } from '~/components/ui/toast/use-toast';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import dapis from '../../../data/dapis.json';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.tuple([z.string(), z.string(), z.string()])),
  }),
});

export async function getServerSideProps() {
  const { data: currentTree } = readTreeDataFrom({
    subfolder: 'dapi-management-merkle-tree-root',
    file: 'current-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: previousTree } = readTreeDataFrom({
    subfolder: 'dapi-management-merkle-tree-root',
    file: 'previous-hash.json',
    schema: merkleTreeSchema,
  });
  const { data: signers } = readSignerDataFrom('dapi-management-merkle-tree-root');

  const diffResult = previousTree
    ? await createTreeDiff({
        subfolder: 'dapi-management-merkle-tree-root',
        previousData: previousTree,
        currentData: currentTree,
        preProcessor: (values) => {
          const dapiName = ethers.utils.parseBytes32String(values[0]);
          return [dapiName, getProviders(dapiName), values[2]];
        },
      })
    : null;

  return {
    props: { currentTree, signers, diffResult },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiManagementTree(props: Props) {
  const { currentTree, signers } = props;

  const merkleTree = createDapiManagementMerkleTree(currentTree.merkleTreeValues.values);

  const { signRoot, isSigning } = useTreeSigner('dAPI management Merkle tree', merkleTree.root, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI management Merkle tree root',
    merkleTree.root,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  useCIVerificationToast();

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
                <TableHead className="whitespace-nowrap">dAPI Name</TableHead>
                <TableHead className="min-w-[30ch]">API Providers</TableHead>
                <TableHead>
                  <Tooltip delayDuration={0} preventCloseOnClick>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" className="group flex h-4 cursor-auto items-center gap-1.5 p-0">
                        <CheckIcon className="h-4 w-4 text-slate-400 group-hover:text-slate-500" />
                        Sponsor Wallet Address
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>The CI verifies the Sponsor Wallet Addresses for you</TooltipContent>
                  </Tooltip>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentTree.merkleTreeValues.values.map((rowValues, i) => {
                const dapiName = ethers.utils.parseBytes32String(rowValues[0]);
                return (
                  <TableRow key={i}>
                    <TableCell>{dapiName}</TableCell>
                    <TableCell>{getProviders(dapiName)}</TableCell>
                    <TableCell>{rowValues[2]}</TableCell>
                  </TableRow>
                );
              })}
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

function getProviders(dapiName: string) {
  const dapiEntry = dapis.find((dapi) => dapi.name === dapiName);
  return (
    dapiEntry?.providers
      .map((alias) => {
        return apisData[alias as keyof typeof apisData]?.name || alias;
      })
      .join(', ') || 'unknown'
  );
}

function useCIVerificationToast() {
  const { toast } = useToast();

  useEffect(() => {
    const acked = window.localStorage.getItem('dapi-management-ci-ack');
    if (acked === 'true') {
      return;
    }

    let dismiss: () => void;
    const timeoutId = setTimeout(() => {
      const result = toast({
        title: 'The CI verifies the following for you',
        description: (
          <div className="w-full">
            <ul className="mb-6 mt-2 flex flex-col gap-1.5 pl-3 text-sm marker:text-teal-400">
              <li className="inline-flex items-center">
                <CheckIcon className="h-4 text-teal-400" /> Data Feed IDs
              </li>
              <li className="inline-flex items-center">
                <CheckIcon className="h-4 text-teal-400" /> Sponsor Wallet Addresses
              </li>
            </ul>
            <Button
              className="w-[10ch]"
              onClick={() => {
                dismiss();
                window.localStorage.setItem('dapi-management-ci-ack', 'true');
              }}
            >
              Got it
            </Button>
          </div>
        ),
        duration: 10000000, // Keep it open
      });

      dismiss = result.dismiss;
    }, 1000);

    return () => {
      dismiss?.();
      clearTimeout(timeoutId);
    };
  }, [toast]);
}
