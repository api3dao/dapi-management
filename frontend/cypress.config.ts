import { defineConfig } from 'cypress';
import { writeFileSync, existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { MerkleTreeData } from './lib/server/file-utils';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      task(
        event: 'seedTreeData',
        arg: {
          subfolder: string;
          signerData?: { hashSigners: string[] };
          currentHashData?: Partial<MerkleTreeData>;
          previousHashData?: Partial<MerkleTreeData>;
        }
      ): Chainable<void>;

      task(event: 'deleteTreeData', arg: { subfolder: string }): Chainable<void>;
    }
  }
}

module.exports = defineConfig({
  defaultCommandTimeout: 15000,
  video: false,

  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on) {
      on('task', {
        /*
         * Creates the files with provided data in the data/.e2e directory and handles providing a subset. Additionally,
         * partial data can be provided for currentHashData and previousHashData, where it gets merged in with the
         * existing data.
         */
        seedTreeData(options: {
          subfolder: string;
          signerData?: { hashSigners: string[] };
          currentHashData?: Partial<MerkleTreeData>;
          previousHashData?: Partial<MerkleTreeData>;
        }) {
          const { subfolder, signerData, currentHashData, previousHashData } = options;

          const treeDirPath = join(process.cwd(), '../data/.e2e', subfolder);
          if (!existsSync(treeDirPath)) {
            mkdirSync(treeDirPath, { recursive: true });
          }

          if (signerData) {
            const signersPath = join(treeDirPath, 'hash-signers.json');
            writeFileSync(signersPath, JSON.stringify(signerData, null, 2));
          }

          if (currentHashData) {
            const currentHashPath = join(treeDirPath, 'current-hash.json');
            const existingData = existsSync(currentHashPath)
              ? JSON.parse(readFileSync(currentHashPath, 'utf8'))
              : undefined;
            writeFileSync(currentHashPath, JSON.stringify({ ...existingData, ...currentHashData }, null, 2));
          }

          if (previousHashData) {
            const previousHashPath = join(treeDirPath, 'previous-hash.json');
            const existingData = existsSync(previousHashPath)
              ? JSON.parse(readFileSync(previousHashPath, 'utf8'))
              : undefined;
            writeFileSync(previousHashPath, JSON.stringify({ ...existingData, ...previousHashData }, null, 2));
          }

          spawnSync(`yarn prettier --write ${treeDirPath}`);
          return null;
        },

        deleteTreeData(options: { subfolder: string }) {
          const { subfolder } = options;
          const treeDirPath = join(process.cwd(), '../data/.e2e', subfolder);
          rmSync(treeDirPath, { recursive: true, force: true });
          return null;
        },
      });

      /*
       * Increase the browser window size to produce higher resolution screenshots.
       * See https://docs.cypress.io/api/plugins/browser-launch-api#Set-screen-size-when-running-headless
       */
      on('before:browser:launch', (browser, launchOptions) => {
        if (!browser.isHeadless) {
          return launchOptions;
        }

        const width = 1920;
        const height = 1080;

        console.info('Setting the browser window size to %d x %d', width, height);

        if (browser.name === 'chrome') {
          launchOptions.args.push(`--window-size=${width},${height}`);
          launchOptions.args.push('--force-device-scale-factor=1');
        }

        if (browser.name === 'electron') {
          launchOptions.preferences.width = width;
          launchOptions.preferences.height = height;
        }

        if (browser.name === 'firefox') {
          launchOptions.args.push(`--width=${width}`);
          launchOptions.args.push(`--height=${height}`);
        }

        return launchOptions;
      });
    },
  },
});
