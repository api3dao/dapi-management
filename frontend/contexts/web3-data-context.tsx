import { ethers } from 'ethers';
import { useState, useEffect, useCallback, createContext, useContext, useMemo, ReactNode } from 'react';

const Web3DataContext = createContext<{
  provider: null | ethers.providers.Web3Provider;
  signer: null | ethers.Signer;
  address: string;
  chainId: null | number;
  chainName: string;
  connectStatus: 'pending' | 'connected' | 'disconnected';
  connect: () => void;
}>({
  provider: null,
  signer: null,
  address: '',
  chainId: null,
  chainName: '',
  connectStatus: 'pending',
  connect() {},
});

export function Web3DataContextProvider(props: { children: ReactNode }) {
  const provider = useMemo(() => {
    return typeof window !== 'undefined' && window.ethereum
      ? new ethers.providers.Web3Provider(window.ethereum, 'any')
      : null;
  }, []);

  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string>('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [chainName, setChainName] = useState<string>('');
  const [connectStatus, setConnectStatus] = useState<'pending' | 'connected' | 'disconnected'>('pending');

  const refreshData = useCallback(async () => {
    if (provider === null) return;

    const clearState = () => {
      setSigner(null);
      setChainId(null);
      setChainName('');
      setAddress('');
      setConnectStatus('disconnected');
    };

    try {
      const accounts = await provider.send('eth_accounts', []);
      if (accounts.length > 0) {
        const network = await provider.getNetwork();
        setSigner(provider.getSigner());
        setChainId(network.chainId);
        setChainName(network.name);
        setAddress(await provider.getSigner().getAddress());
        setConnectStatus('connected');
      } else {
        clearState();
      }
    } catch (err) {
      console.error(err);
      clearState();
    }
  }, [provider]);

  const connect = useCallback(async () => {
    if (provider) {
      await provider.send('eth_requestAccounts', []);
      refreshData();
    }
  }, [provider, refreshData]);

  // Get data on page load
  useEffect(() => {
    if (!window.ethereum) return;

    if (window.ethereum.isConnected()) {
      refreshData();
    }
  }, [refreshData]);

  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.on('accountsChanged', refreshData);
    window.ethereum.on('chainChanged', refreshData);
    window.ethereum.on('disconnect', refreshData);

    return () => {
      window.ethereum!.removeListener('accountsChanged', refreshData);
      window.ethereum!.removeListener('chainChanged', refreshData);
      window.ethereum!.removeListener('disconnect', refreshData);
    };
  }, [refreshData]);

  return (
    <Web3DataContext.Provider
      value={{
        provider,
        signer,
        address,
        chainId,
        chainName,
        connectStatus,
        connect,
      }}
    >
      {props.children}
    </Web3DataContext.Provider>
  );
}

export function useWeb3Data() {
  return useContext(Web3DataContext);
}
