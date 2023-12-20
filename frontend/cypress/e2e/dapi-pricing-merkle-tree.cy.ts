import { ethers } from 'ethers';
import { ACCOUNTS } from '../support/constants';

const subfolder = 'dapi-pricing-merkle-tree-root';

// Hardhat accounts
const [account0Address, account1Address] = ACCOUNTS;

describe('dAPI Pricing Merkle tree', () => {
  beforeEach(() => {
    cy.viewport(1630, 1000);
    cy.mockConnectedMetaMaskWallet({ accountIndex: 0 });

    cy.task('seedTreeData', {
      subfolder,
      signerData: {
        hashSigners: [account0Address, account1Address],
      },

      currentHashData: {
        timestamp: 1701250126,
        hash: '0xa82a766e5f5c13098c50b02c800b6c52dad3fe2d0970add3f8bf412cb919b690',
        signatures: {},
        merkleTreeValues: [
          [
            ethers.utils.formatBytes32String('AAPL/USD'),
            '42161',
            '0x0000000000000000000000000000000000000000000000000000000002faf08000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015180',
            '7948800',
            '3151201131514800000',
          ],
          [
            ethers.utils.formatBytes32String('AAVE/USD'),
            '10',
            '0x0000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015180',
            '7948800',
            '1220729679425228000',
          ],
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
          hashSigners: [account1Address],
        },
      });

      visitDapiPricingPage();

      cy.waitUntilWalletIsConnected();
      cy.findByRole('heading', { name: 'dAPI Pricing Merkle Tree' }).should('exist');
      cy.findByRole('button', { name: 'Sign Root' }).should('be.disabled');
    });

    it('allows a signer to sign the merkle root and updates the ui accordingly on success', () => {
      const existingAccount1Signature =
        '0xab1e1fa91e149ecfdc29a427c86cad9b7d44a0386f6a3ace5b74a3ebbfb7a6eb7bfbf4726a0229cd854a9acc2bf24139cafb01646ce017354b6bf697ec65ac921c';
      cy.task('seedTreeData', {
        subfolder,
        currentHashData: {
          signatures: {
            [account0Address]: 'Ox',
            [account1Address]: existingAccount1Signature,
          },
        },
      });

      visitDapiPricingPage();

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
        '0xc7ac76fbd078a9eba34bc4c9f7eeea74dd8e918551f1ba1c50fa12f4a962733527b0e3157e51c71b5c58ce60c529e04ed2c528194475a38eb33a3a00959e346a1c';

      cy.findByTestId('tree-status-badge').should('have.text', 'Signed');
      cy.findByTestId('signatures-table').within(() => {
        cy.findAllByRole('row').then((rows) => {
          cy.wrap(rows[1]).findByRole('cell', { name: account0Signature });
          cy.wrap(rows[2]).findByRole('cell', { name: existingAccount1Signature });
        });
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

      visitDapiPricingPage();

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
        visitDapiPricingPage();

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

    visitDapiPricingPage();

    cy.findByTestId('signatures-table').within(() => {
      cy.findAllByRole('row').then((rows) => {
        cy.wrap(rows[1]).findByRole('cell', { name: 'mertcan' }).should('exist');
      });
    });
  });
});

function visitDapiPricingPage() {
  cy.visit('/merkle-trees/dapi-pricing');
}
