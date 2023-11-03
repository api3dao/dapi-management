import 'react';

interface Window {
  // Injected by metamask (if installed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ethereum?: any;
}

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}
