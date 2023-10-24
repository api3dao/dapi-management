import { ethers } from 'ethers';
import { useState, useEffect, useCallback, createContext, useContext, useMemo, ReactNode } from 'react';

type ConnectStatus = 'pending' | 'connected' | 'disconnected';

const Web3DataContext = createContext<{
  provider: null | ethers.providers.Web3Provider;
  signer: null | ethers.Signer;
  address: string;
  chainId: null | number;
  chainName: string;
  connectStatus: ConnectStatus;
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

  const [web3State, setWeb3State] = useState<{
    signer: null | ethers.Signer;
    address: string;
    chainId: null | number;
    chainName: string;
    connectStatus: ConnectStatus;
  }>({
    signer: null,
    address: '',
    chainId: null,
    chainName: '',
    connectStatus: 'pending',
  });

  const syncWeb3State = useCallback(async () => {
    if (!provider) return;

    const clearState = () => {
      setWeb3State({
        signer: null,
        address: '',
        chainId: null,
        chainName: '',
        connectStatus: 'disconnected',
      });
    };

    try {
      const accounts = await provider.send('eth_accounts', []);
      if (accounts.length > 0) {
        const network = await provider.getNetwork();
        setWeb3State({
          signer: provider.getSigner(),
          address: await provider.getSigner().getAddress(),
          chainId: network.chainId,
          chainName: network.name,
          connectStatus: 'connected',
        });
      } else {
        clearState();
      }
    } catch (err) {
      console.error(err);
      clearState();
    }
  }, [provider]);

  // Sync state on page load
  useEffect(() => {
    syncWeb3State();
  }, [syncWeb3State]);

  const connect = useCallback(async () => {
    if (provider) {
      await provider.send('eth_requestAccounts', []);
      await syncWeb3State();
    }
  }, [provider, syncWeb3State]);

  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.on('accountsChanged', syncWeb3State);
    window.ethereum.on('chainChanged', syncWeb3State);
    window.ethereum.on('disconnect', syncWeb3State);

    return () => {
      window.ethereum!.removeListener('accountsChanged', syncWeb3State);
      window.ethereum!.removeListener('chainChanged', syncWeb3State);
      window.ethereum!.removeListener('disconnect', syncWeb3State);
    };
  }, [syncWeb3State]);

  const { signer, address, chainId, chainName, connectStatus } = web3State;
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
