interface Window {
  // Injected by metamask (if installed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ethereum?: any;
}

declare module '@nodary/utilities' {
  const computeFeedId: (name: string) => string;
  const computeSponsorWalletAddress: (
    name: string,
    deviationThreshold: number,
    deviationReference: number,
    heartbeatInterval: number
  ) => string;
}
