import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Web3DataContextProvider } from '~/contexts/web3-data-context';
import { TooltipProvider } from '~/components/ui/tooltip';
import '~/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Web3DataContextProvider>
      <TooltipProvider>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </Head>
        <Component {...pageProps} />
      </TooltipProvider>
    </Web3DataContextProvider>
  );
}
