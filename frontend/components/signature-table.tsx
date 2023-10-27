import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface Props {
  signatures: Record<string, string>;
}

export default function SignatureTable(props: Props) {
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
                <TableCell className="bg-amber-0 border-amber-100 text-amber-600">Pending</TableCell>
              ) : (
                <TableCell className="break-words bg-green-50 text-green-600">{signature}</TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
