import some from 'lodash/some';
import { InfoIcon, ShieldCheckIcon, ShieldEllipsisIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { useWeb3Data } from '~/contexts/web3-data-context';
import addressBook from '../../../data/address-book.json';
import 'diff2html/bundles/css/diff2html.min.css';

export { ViewOptionsMenu } from './view-options-menu';
export { TreeDiff } from './tree-diff';

interface TreeStatusBadgeProps {
  signatures: Record<string, string>;
}

export function TreeStatusBadge(props: TreeStatusBadgeProps) {
  const isPendingSignature = some(props.signatures, (sig) => sig === '0x');

  return isPendingSignature ? (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-0.5 text-xs text-amber-600">
      <ShieldEllipsisIcon className="mr-1 w-4 text-amber-400" />
      Pending Signature(s)
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-0.5 text-xs text-green-600">
      <ShieldCheckIcon className="mr-1 w-4 text-green-400" />
      Signed
    </span>
  );
}

interface TreeRootBadgeProps {
  root: string;
  className?: string;
}

export function TreeRootBadge(props: TreeRootBadgeProps) {
  return (
    <span
      className={cn('inline-block break-all rounded-md bg-slate-100 px-3 py-1 text-sm text-slate-600', props.className)}
    >
      Root: {props.root}
    </span>
  );
}

interface SignRootButtonProps {
  signatures: Record<string, string>;
  signRoot: () => void;
  isSigning: boolean;
}

export function SignRootButton(props: SignRootButtonProps) {
  const { signatures, signRoot, isSigning } = props;
  const { address, connectStatus } = useWeb3Data();

  const isSigner = !!signatures[address];
  const canSign = signatures[address] === '0x' && !isSigning;

  const button = (
    <Button disabled={!canSign} className="min-w-[12ch]" onClick={() => signRoot()}>
      {isSigning ? 'Signing...' : 'Sign Root'}
    </Button>
  );

  if (isSigner || connectStatus !== 'connected') {
    return button;
  }

  return (
    <Tooltip preventCloseOnClick delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className="focus-visible:ring-ring inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-offset-2"
          tabIndex={0}
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent className="">
        <p className="flex items-center">You are not a signer</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface SignatureTableProps {
  signers: string[]; // We use this array to make sure we display the signers in the correct order
  signatures: Record<string, string>;
}

export function SignatureTable(props: SignatureTableProps) {
  const { signers, signatures } = props;
  const isMissingName = signers.some((signer) => !getNameForAddress(signer));
  return (
    // We use a fixed table so that the signatures wrap onto new lines when they don't fit
    <Table className="min-w-[40ch] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className={isMissingName ? 'lg:w-[46ch]' : 'md:w-[20ch]'}>Signer</TableHead>
          <TableHead>Signature</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {signers.map((signerAddress) => {
          const signature = signatures[signerAddress];
          const signerName = getNameForAddress(signerAddress);
          return (
            <TableRow key={signerAddress} className="text-sm">
              <TableCell className="break-words align-top text-gray-500">
                {signerName ? <SignerInfo name={signerName} address={signerAddress} /> : signerAddress}
              </TableCell>
              {signature === '0x' ? (
                <TableCell className="bg-amber-0 border-amber-100 text-amber-600">
                  <ShieldEllipsisIcon className="relative top-[-1px] mr-1 inline w-5 text-amber-400" />
                  Pending
                </TableCell>
              ) : (
                <TableCell className="relative break-words pl-9 text-green-600">
                  <ShieldCheckIcon className="absolute left-3 top-1.5 inline w-5 text-green-400" />
                  {signature}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface SignerInfoProps {
  name: string;
  address: string;
}

function SignerInfo(props: SignerInfoProps) {
  return (
    <Tooltip delayDuration={0} preventCloseOnClick>
      <TooltipTrigger asChild>
        <Button variant="ghost" className="group inline-flex h-4 cursor-auto items-center gap-1.5 p-0">
          <InfoIcon className="h-4 w-4 text-gray-300 group-hover:text-gray-400" />
          {props.name}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.address}</TooltipContent>
    </Tooltip>
  );
}

function getNameForAddress(address: string) {
  return (addressBook as Record<string, string>)[address];
}
