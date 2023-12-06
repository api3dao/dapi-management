import { useEffect, useState } from 'react';
import { DiffMode } from './types';

export function useDiffMode() {
  const [mode, setMode] = useState<DiffMode>(null);

  useEffect(() => {
    const storedMode = window.localStorage.getItem('diff-mode') as DiffMode;
    setMode(storedMode || 'split');
  }, []);

  const onChange = (newMode: NonNullable<DiffMode>) => {
    setMode(newMode);
    window.localStorage.setItem('diff-mode', newMode);
  };

  return [mode, onChange] as const;
}
