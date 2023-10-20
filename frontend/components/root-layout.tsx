import { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import { useRouter } from 'next/router';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <div className={`flex min-h-screen flex-row text-gray-800 ${inter.className}`}>
      <aside className="w-full max-w-[200px] bg-gray-100">
        <div className="sticky top-0 w-full p-4">
          <nav className="flex flex-col text-gray-500">
            <Link href="/" className="mb-5">
              <Image src="/logo.png" alt="Home" width={60} height={60} priority />
            </Link>
            <h3 className="mb-2 font-medium">Merkle Trees</h3>
            <div className="flex flex-col gap-2 text-sm">
              <NavLink href="/merkle-trees/api-integration">API Integration</NavLink>
              <NavLink href="/merkle-trees/dapi-fallback">dAPI Fallback</NavLink>
              <NavLink href="/merkle-trees/dapi-management">dAPI Management</NavLink>
              <NavLink href="/merkle-trees/prices">Price</NavLink>
            </div>
          </nav>
        </div>
      </aside>
      <main role="main" className="w-full px-10 pt-4">
        {props.children}
      </main>
    </div>
  );
}

function NavLink(props: { href: string; children: ReactNode }) {
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
