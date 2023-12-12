import { defineConfig } from 'cypress';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
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
          signerData: unknown;
          currentHashData: MerkleTreeData;
          previousHashData: MerkleTreeData;
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
    setupNodeEvents(on) {
      on('task', {
        seedTreeData(options: {
          subfolder: string;
          signerData?: unknown;
          currentHashData?: MerkleTreeData;
          previousHashData?: MerkleTreeData;
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
            writeFileSync(currentHashPath, JSON.stringify(currentHashData, null, 2));
          }

          if (previousHashData) {
            const previousHashPath = join(treeDirPath, 'previous-hash.json');
            writeFileSync(previousHashPath, JSON.stringify(previousHashData, null, 2));
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
    },
  },
});
