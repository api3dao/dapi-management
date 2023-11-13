import { useEffect, useRef, useState } from 'react';
import some from 'lodash/some';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
import { InfoIcon, ShieldCheckIcon, ShieldEllipsisIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Button } from '~/components/ui/button';
import { Toggle } from '~/components/ui/toggle';
import { cn } from '~/lib/utils';
import addressBook from '../../../data/address-book.json';
import 'diff2html/bundles/css/diff2html.min.css';

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
      className={cn('inline-block break-all rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-900', props.className)}
    >
      Root: {props.root}
    </span>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          className="group inline-flex h-4 cursor-auto items-center gap-1.5 p-0"
          onClick={(ev) => {
            // We don't want to close the tooltip when the trigger is clicked
            ev.preventDefault();
          }}
        >
          <InfoIcon className="h-4 w-4 text-gray-300 group-hover:text-gray-400" />
          {props.name}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        className="border-0 bg-gray-600 text-xs text-gray-200"
        onPointerDownOutside={(ev) => {
          // We don't want to close the tooltip when the trigger is clicked
          if (triggerRef.current!.contains(ev.target as Node)) {
            ev.preventDefault();
          }
        }}
      >
        {props.address}
      </TooltipContent>
    </Tooltip>
  );
}

interface TreeDiffProps {
  diffResult: null | { diff: string; status: 'success' } | { status: 'error' };
}

type DiffMode = null | 'unified' | 'split';

export function TreeDiff(props: TreeDiffProps) {
  const { diffResult } = props;

  const [mode, setMode] = useState<DiffMode>(null);
  useEffect(() => {
    const storedMode = window.localStorage.getItem('diff-mode');
    setMode((storedMode || 'split') as DiffMode);
  }, []);

  useEffect(() => {
    if (!mode) return;

    if (diffResult?.status === 'success' && diffResult.diff) {
      const element = document.getElementById('tree-diff-container')!;
      const ui = new Diff2HtmlUI(element, diffResult.diff, {
        drawFileList: false,
        fileContentToggle: false,
        synchronisedScroll: true,
        outputFormat: mode === 'unified' ? 'line-by-line' : 'side-by-side',
        rawTemplates: { 'tag-file-renamed': '' },
      });
      ui.draw();
      ui.highlightCode();
    }
  }, [diffResult, mode]);

  const previousFile = <span className="font-semibold">previous-hash.json</span>;
  const currentFile = <span className="font-semibold">current-hash.json</span>;

  return (
    <div>
      {diffResult == null ? (
        <p className="my-4 text-sm text-gray-500">
          There is no {previousFile} file to compare the {currentFile} file with.
        </p>
      ) : diffResult.status === 'error' ? (
        <p className="my-4 inline-block rounded bg-red-100 px-4 py-3 text-sm text-red-700">
          Something went wrong comparing {previousFile} and {currentFile}.
        </p>
      ) : diffResult.diff === '' ? (
        <p className="my-4 text-sm text-gray-500">
          The contents of {previousFile} and {currentFile} are identical.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="my-4 text-sm text-gray-500">
              Shows the difference between the {previousFile} and the {currentFile} files.
            </p>
            <Toggle
              variant="outline"
              size="sm"
              onPressedChange={(unified) => {
                const newMode = unified ? 'unified' : 'split';
                setMode(newMode);
                window.localStorage.setItem('diff-mode', newMode);
              }}
              pressed={mode === 'unified'}
              aria-label="Toggle unified"
            >
              Unified
            </Toggle>
          </div>
          <div id="tree-diff-container" className="w-full overflow-x-auto" />
        </>
      )}
    </div>
  );
}

function getNameForAddress(address: string) {
  return (addressBook as Record<string, string>)[address];
}
