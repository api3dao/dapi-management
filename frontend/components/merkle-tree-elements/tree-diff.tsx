import { useEffect } from 'react';
import forEach from 'lodash/forEach';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
import addressBook from '../../../data/address-book.json';
import { DiffMode } from './types';
import 'diff2html/bundles/css/diff2html.min.css';

interface TreeDiffProps {
  diffResult: null | { diff: string; status: 'success' } | { status: 'error' };
  diffMode: DiffMode;
  raw: boolean;
}

export function TreeDiff(props: TreeDiffProps) {
  const { diffResult, diffMode, raw } = props;

  useEffect(() => {
    if (!diffMode) return;

    if (diffResult?.status === 'success' && diffResult.diff) {
      const element = document.getElementById('tree-diff-container')!;
      const ui = new Diff2HtmlUI(element, diffResult.diff, {
        drawFileList: false,
        fileContentToggle: false,
        synchronisedScroll: true,
        outputFormat: diffMode === 'unified' ? 'line-by-line' : 'side-by-side',
        rawTemplates: { 'tag-file-renamed': '' },
      });
      ui.draw();
      ui.highlightCode();

      if (raw) {
        // Keep known addresses as is
        return;
      }

      // Replace known addresses with their names
      const elementsToUpdate: [HTMLElement, string][] = [];
      forEach(addressBook, (name, address) => {
        const xpath = `//span[text()='${address}' or text()='"${address}"']`;
        const result = document.evaluate(xpath, element, null, XPathResult.ANY_TYPE, null);
        let matchingElement = result.iterateNext() as HTMLElement | null;

        while (matchingElement) {
          const wrapInQuotes = matchingElement.textContent!.startsWith('"');
          // We can't update the DOM while iterating over the xpath results
          elementsToUpdate.push([matchingElement, wrapInQuotes ? `"${name}"` : name]);
          matchingElement = result.iterateNext() as HTMLElement | null;
        }
      });

      elementsToUpdate.forEach(([el, newText]) => {
        el.textContent = newText;
      });
    }
  }, [diffResult, diffMode, raw]);

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
          <p className="my-4 text-sm text-gray-500">
            Shows the difference between the {previousFile} and the {currentFile} files.
          </p>
          <div id="tree-diff-container" className="w-full overflow-x-auto" />
        </>
      )}
    </div>
  );
}
