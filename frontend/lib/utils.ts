import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Unit = 'wei' | 'ether';

export function convertWeiTo(unit: Unit, weiInput: string) {
  const wei = parseFloat(weiInput) || 0;

  const units = {
    wei: 1,
    ether: 1e18,
  };

  return wei / units[unit];
}
