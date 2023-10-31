import type { AppProps } from 'next/app';
import { Web3DataContextProvider } from '~/contexts/web3-data-context';
import '~/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Web3DataContextProvider>
      <Component {...pageProps} />
    </Web3DataContextProvider>
  );
}
