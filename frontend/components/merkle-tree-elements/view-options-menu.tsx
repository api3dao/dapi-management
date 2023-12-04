import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { DropdownMenuTrigger } from '@radix-ui/react-dropdown-menu';
import { SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { SideBySideDiffIcon } from '../ui/icons/side-by-side-diff-icon';
import { UnifiedDiffIcon } from '../ui/icons/unified-diff-icon';
import { DiffMode } from './types';

interface Props {
  diffMode: DiffMode;
  onDiffModeChange: (mode: NonNullable<DiffMode>) => void;
}

export function ViewOptionsMenu(props: Props) {
  const { diffMode } = props;
  const router = useRouter();
  const params = useSearchParams();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="flex h-8">
          <SlidersHorizontalIcon className="mr-2 h-4 w-4" />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuLabel className="text-slate-500">Values</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={params.get('raw') === 'true' ? 'raw' : 'human-readable'}
          onValueChange={(value) => {
            if (value === 'raw') {
              router.replace(router.pathname + `?raw=true`);
            } else {
              router.replace(router.pathname);
            }
          }}
        >
          <DropdownMenuRadioItem value="human-readable" className="flex gap-2">
            Human-readable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="raw" className="flex gap-2">
            Raw
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator className="my-3" />

        <DropdownMenuLabel className="text-slate-500">Diff</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={diffMode || 'unknown'}
          onValueChange={(value) => {
            props.onDiffModeChange(value as 'split' | 'unified');
          }}
        >
          <DropdownMenuRadioItem value="split" className="flex gap-2">
            <SideBySideDiffIcon className="h-10 w-10" />
            Side by side
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="unified" className="flex gap-2">
            <UnifiedDiffIcon className="h-10 w-10" />
            Unified
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
