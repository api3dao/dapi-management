import { ReactNode, useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import forEach from 'lodash/forEach';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { Toggle } from '~/components/ui/toggle';
import addressBook from '../../../data/address-book.json';
import 'diff2html/bundles/css/diff2html.min.css';

interface TreeDiffProps {
  diffResult: null | { diff: string; status: 'success' } | { status: 'error' };
}

type DiffMode = null | 'unified' | 'split';

export function TreeDiff(props: TreeDiffProps) {
  const { diffResult } = props;

  const [mode, setMode] = useState<DiffMode>(null);
  useEffect(() => {
    const storedMode = window.localStorage.getItem('diff-mode');
    setMode((storedMode || 'split') as DiffMode);
  }, []);

  useEffect(() => {
    if (!mode) return;

    if (diffResult?.status === 'success' && diffResult.diff) {
      const element = document.getElementById('tree-diff-container')!;
      const ui = new Diff2HtmlUI(element, diffResult.diff, {
        drawFileList: false,
        fileContentToggle: false,
        synchronisedScroll: true,
        outputFormat: mode === 'unified' ? 'line-by-line' : 'side-by-side',
        rawTemplates: { 'tag-file-renamed': '' },
      });
      ui.draw();
      ui.highlightCode();

      const roots: [Root, ReactNode][] = [];
      forEach(addressBook, (alias, value) => {
        const xpath = `//span[text()='${value}' or text()='"${value}"']`;
        const result = document.evaluate(xpath, element, null, XPathResult.ANY_TYPE, null);
        let matchingElement = result.iterateNext() as HTMLElement | null;

        while (matchingElement) {
          const root = createRoot(matchingElement);
          const wrapInQuotes = matchingElement.textContent!.startsWith('"');
          const reactNode = (
            <TooltipProvider>
              <DiffAlias alias={alias} value={value} wrapInQuotes={wrapInQuotes} />
            </TooltipProvider>
          );
          roots.push([root, reactNode]);

          matchingElement = result.iterateNext() as HTMLElement | null;
        }
      });

      // We can't mutate the DOM while the xpath result is still iterating through matched elements, so we
      // render afterward
      roots.forEach(([root, reactNode]) => {
        root.render(reactNode);
      });

      return () => {
        // We run this in a timeout to avoid a false positive warning from React
        setTimeout(() => roots.forEach(([root]) => root.unmount()), 0);
      };
    }
  }, [diffResult, mode]);

  const previousFile = <span className="font-semibold">previous-hash.json</span>;
  const currentFile = <span className="font-semibold">current-hash.json</span>;

  return (
    <div>
      {diffResult == null ? (
        <p className="my-4 text-sm text-gray-500">
          There is no {previousFile} file to compare the {currentFile} file with.
        </p>
      ) : diffResult.status === 'error' ? (
        <p className="my-4 inline-block rounded bg-red-100 px-4 py-3 text-sm text-red-700">
          Something went wrong comparing {previousFile} and {currentFile}.
        </p>
      ) : diffResult.diff === '' ? (
        <p className="my-4 text-sm text-gray-500">
          The contents of {previousFile} and {currentFile} are identical.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="my-4 text-sm text-gray-500">
              Shows the difference between the {previousFile} and the {currentFile} files.
            </p>
            <Toggle
              variant="outline"
              size="sm"
              onPressedChange={(unified) => {
                const newMode = unified ? 'unified' : 'split';
                setMode(newMode);
                window.localStorage.setItem('diff-mode', newMode);
              }}
              pressed={mode === 'unified'}
              aria-label="Toggle unified"
            >
              Unified
            </Toggle>
          </div>
          <div id="tree-diff-container" className="w-full overflow-x-auto" />
        </>
      )}
    </div>
  );
}

interface DiffAliasProps {
  alias: string;
  value: string;
  wrapInQuotes: boolean;
}

function DiffAlias(props: DiffAliasProps) {
  const { alias, value, wrapInQuotes } = props;
  return (
    <Tooltip delayDuration={0} preventCloseOnClick>
      {wrapInQuotes && '"'}
      <TooltipTrigger asChild>
        <span
          className="cursor-default underline decoration-transparent/40 underline-offset-2 hover:decoration-transparent/70"
          role="button"
          tabIndex={0}
        >
          {alias}
        </span>
      </TooltipTrigger>
      <TooltipContent>{value}</TooltipContent>
      {wrapInQuotes && '"'}
    </Tooltip>
  );
}
