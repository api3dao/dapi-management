import { useEffect } from 'react';
import some from 'lodash/some';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
import { ShieldCheckIcon, ShieldEllipsisIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { cn } from '~/lib/utils';
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
      className={cn(
        'inline-block whitespace-nowrap break-words rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-900',
        props.className
      )}
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

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[46ch]">Signer</TableHead>
          <TableHead>Signature</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {signers.map((signer) => {
          const signature = signatures[signer];
          return (
            <TableRow key={signer} className="text-sm">
              <TableCell className="break-words align-top text-gray-500">{signer}</TableCell>
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

interface TreeDiffProps {
  diff: string | null;
}

export function TreeDiff(props: TreeDiffProps) {
  const { diff } = props;

  useEffect(() => {
    if (!diff) return;

    const element = document.getElementById('tree-diff-container')!;
    const ui = new Diff2HtmlUI(element, diff, {
      drawFileList: false,
      fileContentToggle: false,
      synchronisedScroll: true,
      outputFormat: 'side-by-side',
      rawTemplates: { 'tag-file-renamed': '' },
    });
    ui.draw();
    ui.highlightCode();
  }, [diff]);

  const previousFile = <span className="font-semibold">previous-hash.json</span>;
  const currentFile = <span className="font-semibold">current-hash.json</span>;

  return (
    <div>
      {diff == null ? (
        <p className="my-4 text-sm text-gray-500">
          There is no {previousFile} file to compare the {currentFile} file with.
        </p>
      ) : diff === '' ? (
        <p className="my-4 text-sm text-gray-500">
          The contents of {previousFile} and {currentFile} are identical.
        </p>
      ) : (
        <>
          <p className="my-4 text-sm text-gray-500">
            Shows the difference between the {previousFile} and the {currentFile} files.
          </p>
          <div id="tree-diff-container" className="w-full overflow-x-auto" />
        </>
      )}
    </div>
  );
}
