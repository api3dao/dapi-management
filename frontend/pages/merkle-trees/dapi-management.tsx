import { ReactNode, useEffect } from 'react';
import { z } from 'zod';
import { ethers } from 'ethers';
import { apisData } from '@api3/api-integrations';
import { AlertTriangleIcon, InfoIcon } from 'lucide-react';
import RootLayout from '~/components/root-layout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Button } from '~/components/ui/button';
import {
  PageHeading,
  TreeStatusBadge,
  TreeRootBadge,
  SignatureTable,
  SignRootButton,
  ViewOptionsMenu,
  TreeDiff,
} from '~/components/merkle-tree-elements';
import { getMerkleTreeServerSideProps } from '~/lib/server/page-props';
import { validateTreeRootSignatures } from '~/lib/merkle-tree-utils';
import { GetServerSidePropsContext, InferGetServerSidePropsType } from 'next';
import { useToast } from '~/components/ui/toast/use-toast';
import { useTreeSigner } from '~/components/merkle-tree-elements/use-tree-signer';
import { useDiffMode } from '~/components/merkle-tree-elements/use-diff-mode';
import dapis from '../../../data/dapis.json';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
  signatures: z.record(z.string()),
  merkleTreeValues: z.array(z.tuple([z.string(), z.string(), z.string()])),
});

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const showRawValues = context.query.raw === 'true';

  const { currentTree, signers, diffResult } = await getMerkleTreeServerSideProps({
    subfolder: 'dapi-management-merkle-tree-root',
    schema: merkleTreeSchema,
    diff: {
      preProcess: !showRawValues,
      preProcessor: (values) => {
        const dapiName = ethers.utils.parseBytes32String(values[0]);
        return [dapiName, getProviders(dapiName)];
      },
    },
  });

  return {
    props: { currentTree, signers, diffResult, showRawValues },
  };
}

type Props = InferGetServerSidePropsType<typeof getServerSideProps>;

export default function DapiManagementTree(props: Props) {
  const { currentTree, signers, showRawValues } = props;

  const { signRoot, isSigning } = useTreeSigner('dAPI management Merkle tree', currentTree.hash, currentTree.timestamp);

  const signatures = validateTreeRootSignatures(
    'dAPI management Merkle tree root',
    currentTree.hash,
    currentTree.timestamp,
    currentTree.signatures,
    signers
  );

  useCIVerificationToast();

  const [diffMode, setDiffMode] = useDiffMode();

  return (
    <RootLayout>
      <TreeStatusBadge signatures={signatures} />
      <PageHeading>dAPI Management Merkle Tree</PageHeading>
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
            <Table className="mt-4">
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="whitespace-nowrap">dAPI Name</TableHead>
                  <TableHead className="min-w-[30ch]">API Providers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentTree.merkleTreeValues.map((rowValues, i) => {
                  const dapiName = ethers.utils.parseBytes32String(rowValues[0]);
                  return (
                    <TableRow key={i}>
                      <TableCell>{dapiName}</TableCell>
                      <TableCell>{getProviders(dapiName)}</TableCell>
                    </TableRow>
                  );
                })}
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
    <Table className="mt-4">
      <TableHeader sticky>
        <TableRow>
          <TableHead className="whitespace-nowrap">dAPI Name</TableHead>
          <VerifiedTableHead tooltip="The CI verifies the Data Feed IDs for you">Data Feed ID</VerifiedTableHead>
          <VerifiedTableHead tooltip="The CI verifies the Sponsor Wallet Addresses for you">
            Sponsor Wallet Address
          </VerifiedTableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.values.map((rowValues, i) => {
          return (
            <TableRow key={i}>
              <TableCell>{rowValues[0]}</TableCell>
              <TableCell>{rowValues[1]}</TableCell>
              <TableCell>{rowValues[2]}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface VerifiedTableHeadProps {
  children: ReactNode;
  tooltip: string;
}

function VerifiedTableHead(props: VerifiedTableHeadProps) {
  return (
    <TableHead>
      <Tooltip delayDuration={0} preventCloseOnClick>
        <TooltipTrigger asChild>
          <Button variant="ghost" className="group flex h-4 cursor-auto items-center gap-1.5 p-0">
            <InfoIcon className="h-4 w-4 text-slate-400 group-hover:text-slate-500" />
            {props.children}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[33ch]">
          {props.tooltip}
          <p className="my-2 rounded bg-slate-600 px-3 py-2">
            Please check the CI to make sure that the verification was a success
          </p>
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

function getProviders(dapiName: string) {
  const dapiEntry = dapis.find((dapi) => dapi.name === dapiName);
  return (
    dapiEntry?.providers
      .map((alias) => {
        return apisData[alias as keyof typeof apisData]?.name || alias;
      })
      .join(', ') || 'Unknown'
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
            <ul className="mb-6 mt-1 flex list-disc flex-col gap-1.5 pl-8 text-sm marker:text-slate-400">
              <li>Data Feed IDs</li>
              <li>Sponsor Wallet Addresses</li>
            </ul>
            <p className="mb-4 inline-flex gap-1.5 rounded-md bg-blue-100 py-3 pl-3 pr-4">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 min-w-[1rem] text-blue-400" />
              Please check the CI to make sure that the verification was a success
            </p>
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
