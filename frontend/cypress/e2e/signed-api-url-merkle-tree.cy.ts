import { ACCOUNTS } from '../support/constants';

const subfolder = 'signed-api-url-merkle-tree-root';

// Hardhat accounts
const [account0Address, account1Address] = ACCOUNTS;

describe('Signed API URL Merkle tree', () => {
  beforeEach(() => {
    cy.viewport(1630, 1000);
    cy.mockConnectedMetaMaskWallet();

    cy.task('seedTreeData', {
      subfolder,
      signerData: {
        hashSigners: [account0Address, account1Address],
      },

      currentHashData: {
        timestamp: 1701689882,
        hash: '0x390d436d0960ea57fa940a5afa16d96e61ff78e83d726662d847440cdb10498d',
        signatures: {},
        merkleTreeValues: [
          ['0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4', 'https://signed1.api-url.dev'],
          ['0xbC6471E88d8aFe936A45bEB8bd20a210EBEF6822', 'https://signed2.api-url.dev'],
          ['0x8676eA8B6Ebe5b8FBbc25FF55192bADf39D7D61b', 'https://signed3.api-url.dev'],
        ],
      },

      previousHashData: {
        timestamp: 1676940000,
        hash: '0x390d436d0960ea57fa940a5afa16d96e61ff78e83d726662d847440cdb10498d',
        signatures: {},
        merkleTreeValues: [
          ['0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4', 'https://signed1.api-url.dev'],
          ['0x8676eA8B6Ebe5b8FBbc25FF55192bADf39D7D61b', 'https://signed3.api-url.dev'],
        ],
      },
    });
  });

  afterEach(() => {
    cy.task('deleteTreeData', { subfolder });
  });

  describe('signing process', () => {
    it('disables the sign button when the user is not a signer', () => {
      cy.task('seedTreeData', {
        subfolder,
        signerData: {
          hashSigners: ['0x80efDd3bB15F2108C407049C5575490858800D47'],
        },
      });

      visitSignedApiUrlPage();

      cy.waitUntilWalletIsConnected();
      cy.findByRole('heading', { name: 'Signed API URL Merkle Tree' }).should('exist');
      cy.findByRole('button', { name: 'Sign Root' }).should('be.disabled');
    });

    it('allows a signer to sign the merkle root and updates the ui accordingly on success', () => {
      const existingAccount1Signature =
        '0x5953843978fe8504c168e2fe17df225bea084c7df15c6063556aafaa4edd2a845470ad4c90647a2db724be8c48ffabc9e11d7d2eee8f6e97c190dccdc802ba8f1b';
      cy.task('seedTreeData', {
        subfolder,
        currentHashData: {
          signatures: {
            [account0Address]: 'Ox',
            [account1Address]: existingAccount1Signature,
          },
        },
      });

      visitSignedApiUrlPage();

      cy.findByTestId('tree-status-badge').should('have.text', 'Pending Signature(s)');
      cy.findByTestId('signatures-table').within(() => {
        cy.findAllByRole('row').then((rows) => {
          cy.wrap(rows).should('have.length', 3); // The first row is the table header
          cy.wrap(rows[1]).findByRole('cell', { name: account0Address });
          cy.wrap(rows[1]).findByRole('cell', { name: 'Pending' });
          cy.wrap(rows[2]).findByRole('cell', { name: account1Address });
          cy.wrap(rows[2]).findByRole('cell', { name: existingAccount1Signature });
        });
      });

      cy.findByRole('button', { name: 'Sign Root' }).should('not.be.disabled').click();
      cy.findByRole('button', { name: 'Signing...' }).should('be.disabled');
      cy.findByRole('region', { name: 'Notifications (F8)' }).should('contain.text', 'Successfully signed tree root');
      cy.findByRole('button', { name: 'Sign Root' }).should('be.disabled');

      const account0Signature =
        '0xf5d3bfb91495e641170b86312b41742fa71980af20770a579df3660fd550223b1e16ed386b1ec44be13d8212c77391353e5a7549b34e6fbe1a25315f25b15e1c1b';

      cy.findByTestId('tree-status-badge').should('have.text', 'Signed');
      cy.findByTestId('signatures-table').within(() => {
        cy.findAllByRole('row').then((rows) => {
          cy.wrap(rows[1]).findByRole('cell', { name: account0Signature });
          cy.wrap(rows[2]).findByRole('cell', { name: existingAccount1Signature });
        });
      });

      cy.findByRole('tab', { name: 'Tree Diff' }).click();
      cy.findByRole('tabpanel', { name: 'Tree Diff' }).within(() => {
        cy.findByText(`"${account0Signature}"`).should('exist');
      });
    });

    it('ignores invalid signatures', () => {
      cy.task('seedTreeData', {
        subfolder,
        signerData: {
          hashSigners: [account0Address],
        },
        currentHashData: {
          signatures: {
            [account0Address]:
              '0xcfc54e2180159f0570b9f51eda42a282140cb97b07d28d80d588362def45a9da44d0236955c7f7bde37d6dd614abc637ca83992df6e9c38686402139d7293ebd1c',
          },
        },
      });

      visitSignedApiUrlPage();

      cy.findByTestId('tree-status-badge').should('have.text', 'Pending Signature(s)');
      cy.findByTestId('signatures-table').within(() => {
        cy.findAllByRole('row').then((rows) => {
          cy.wrap(rows).should('have.length', 2); // The first row is the table header
          cy.wrap(rows[1]).findByRole('cell', { name: account0Address });
          cy.wrap(rows[1]).findByRole('cell', { name: 'Pending' });
        });
      });
      cy.findByRole('button', { name: 'Sign Root' }).should('not.be.disabled');
    });

    describe('sign endpoint', () => {
      it('should return an error if the user somehow manages to call it without being a signer', () => {
        // We first visit the page, and then update the signer data behind the scenes to remove the connected wallet
        visitSignedApiUrlPage();

        cy.task('seedTreeData', {
          subfolder,
          signerData: {
            hashSigners: [account1Address],
          },
        });

        cy.findByRole('button', { name: 'Sign Root' }).should('not.be.disabled').click();
        cy.findByRole('region', { name: 'Notifications (F8)' }).should('contain.text', 'Failed to sign tree root');
      });
    });
  });

  it('uses the address book', () => {
    cy.task('seedTreeData', {
      subfolder,
      signerData: {
        hashSigners: ['0x80efDd3bB15F2108C407049C5575490858800D47'],
      },
    });

    visitSignedApiUrlPage();

    cy.findByTestId('signatures-table').within(() => {
      cy.findAllByRole('row').then((rows) => {
        cy.wrap(rows[1]).findByRole('cell', { name: 'mertcan' }).should('exist');
      });
    });
  });

  it('displays human-readable values', () => {
    visitSignedApiUrlPage();

    cy.findByRole('tabpanel', { name: 'Tree Values' }).within(() => {
      cy.findByRole('columnheader', { name: 'API Providers' }).should('exist');
      cy.findByRole('columnheader', { name: 'Signed API URL' }).should('exist');
      cy.findByRole('columnheader', { name: 'Airnode Address' }).should('not.exist');

      cy.findAllByRole('row').then((rows) => {
        cy.wrap(rows[1]).findByRole('cell', { name: 'Nodary' }).should('exist');
        cy.wrap(rows[1]).findByRole('cell', { name: 'https://signed1.api-url.dev' }).should('exist');

        cy.wrap(rows[2]).findByRole('cell', { name: 'NewChangeFX-Crypto, NewChangeFX-Forex' }).should('exist');
        cy.wrap(rows[2]).findByRole('cell', { name: 'https://signed2.api-url.dev' }).should('exist');
      });
    });

    cy.findByRole('tab', { name: 'Tree Diff' }).click();
    cy.findByRole('tabpanel', { name: 'Tree Diff' }).within(() => {
      cy.findByText('"NewChangeFX-Crypto, NewChangeFX-Forex"').should('exist');
      cy.findByText('"https://signed2.api-url.dev"').should('exist');
    });
  });

  it('can display raw values', () => {
    visitSignedApiUrlPage();

    cy.findByRole('button', { name: 'View' }).click();
    cy.findByRole('menu', { name: 'View' }).within(() => {
      cy.findByRole('menuitemradio', { name: 'Raw' }).click();
    });

    cy.findByRole('tabpanel', { name: 'Tree Values' }).within(() => {
      cy.findByRole('columnheader', { name: 'Airnode Address' }).should('exist');
      cy.findByRole('columnheader', { name: 'Signed API URL' }).should('exist');
      cy.findByRole('columnheader', { name: 'API Providers' }).should('not.exist');

      cy.findAllByRole('row').then((rows) => {
        // Airnode Address
        cy.wrap(rows[1]).findByRole('cell', { name: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4' }).should('exist');
        cy.wrap(rows[1]).findByRole('cell', { name: 'https://signed1.api-url.dev' }).should('exist');
      });
    });

    cy.findByRole('tab', { name: 'Tree Diff' }).click();
    cy.findByRole('tabpanel', { name: 'Tree Diff' }).within(() => {
      // Airnode Address
      cy.findByText('"0xbC6471E88d8aFe936A45bEB8bd20a210EBEF6822"').should('exist');
      cy.findByText('"https://signed2.api-url.dev"').should('exist');
    });
  });
});

function visitSignedApiUrlPage() {
  cy.visit('/merkle-trees/signed-api-url');
}
