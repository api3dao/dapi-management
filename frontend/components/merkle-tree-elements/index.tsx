import some from 'lodash/some';
import { ShieldCheckIcon, ShieldEllipsisIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { cn } from '~/lib/utils';

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
  signatures: Record<string, string>;
}

export function SignatureTable(props: SignatureTableProps) {
  const { signatures } = props;

  return (
    <Table className="min-w-[120ch] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[46ch]">Signer</TableHead>
          <TableHead>Signature</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Object.keys(signatures).map((signer) => {
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
