import { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import { useRouter } from 'next/router';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { useWeb3Data } from '~/contexts/web3-data-context';

const inter = Inter({ subsets: ['latin'] });

interface Props {
  children: ReactNode;
}

export default function RootLayout(props: Props) {
  return (
    <div className={`flex text-gray-800 ${inter.className}`}>
      <aside className="fixed bottom-0 left-0 top-0 z-10 h-screen w-[200px] overflow-auto border-r border-gray-200 bg-gray-100">
        <nav className="flex min-h-screen flex-col p-4 text-gray-500">
          <Link href="/" className="mb-5">
            <Image src="/logo.png" alt="Home" width={60} height={60} priority />
          </Link>
          <h3 className="mb-2 font-medium">Merkle Trees</h3>
          <div className="flex flex-col gap-2 text-sm">
            <NavLink href="/merkle-trees/dapi-fallback">dAPI Fallback</NavLink>
            <NavLink href="/merkle-trees/dapi-management">dAPI Management</NavLink>
            <NavLink href="/merkle-trees/dapi-pricing">dAPI Pricing</NavLink>
            <NavLink href="/merkle-trees/signed-api-url">Signed API URL</NavLink>
          </div>
          <div className="mt-auto pt-6">
            <Account />
          </div>
        </nav>
      </aside>
      <main role="main" className="ml-[200px] flex-grow bg-white px-5 py-4">
        {props.children}
      </main>
    </div>
  );
}

interface NavLinkProps {
  href: string;
  children: ReactNode;
}

function NavLink(props: NavLinkProps) {
  const router = useRouter();
  const isActive = router.pathname === props.href;
  return (
    <Link
      className={isActive ? '-mx-2 -my-1 bg-gray-200 px-2 py-1 text-gray-800' : 'hover:text-gray-800'}
      href={props.href}
    >
      {props.children}
    </Link>
  );
}

function Account() {
  const { connect, connectStatus, address } = useWeb3Data();

  switch (connectStatus) {
    case 'pending':
      return null;

    case 'connected':
      return (
        <div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full bg-gradient-to-br from-green-400 to-green-600" />
            <div className="text-sm">{shortenAddress(address)}</div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="mt-2 border-gray-300 bg-transparent">
                How to disconnect?
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-[190px] text-sm">
              You can disconnect your wallet via MetaMask.
            </PopoverContent>
          </Popover>
        </div>
      );

    case 'disconnected':
      return (
        <Button className="w-full" onClick={() => connect()}>
          Connect
        </Button>
      );
  }
}

function shortenAddress(address: string, options?: { startLength?: number; endLength?: number }) {
  const startLength = options?.startLength ?? 9;
  const endLength = options?.endLength ?? 4;
  return address.substring(0, startLength) + '...' + address.substring(address.length - endLength, address.length);
}
