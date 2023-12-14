const subfolder = 'dapi-management-merkle-tree-root';

// Hardhat accounts
const account0Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const account1Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('dAPI Management Merkle tree', () => {
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
        hash: '0xb1f092e5529d289caa4421bce90d92b0250198941328111147d6be4beb06b207',
        signatures: {},
        merkleTreeValues: [
          [
            '0x4141504c2f555344000000000000000000000000000000000000000000000000',
            '0xe82f95dfbe8f3015a2bc3b6573a86592534ee8d84843779751431da9a51d077e',
            '0x8cd50C14594B74ae85baE27f7495c3180e2Fa238',
          ],
          [
            '0x414156452f555344000000000000000000000000000000000000000000000000',
            '0x386bd78818ccc6e98a86e1ba059877b1a83282c263f040b64c0702eae5312a52',
            '0xBf57be4fE96a5b3b85070466A2362D87610eA021',
          ],
          [
            '0x4144412f55534400000000000000000000000000000000000000000000000000',
            '0xd0b3f3da2561cb442bd0cd5d5be5ada2580cb5b49bdf0e9374d8f8dbfcd5aeb2',
            '0x2E9aA1a0Cb85c0dF938D99b6306c1db66129Bf73',
          ],
        ],
      },

      previousHashData: {
        timestamp: 1701689882,
        hash: '0xb1f092e5529d289caa4421bce90d92b0250198941328111147d6be4beb06b205',
        signatures: {},
        merkleTreeValues: [
          [
            '0x4141504c2f555344000000000000000000000000000000000000000000000000',
            '0xe82f95dfbe8f3015a2bc3b6573a86592534ee8d84843779751431da9a51d077e',
            '0x8cd50C14594B74ae85baE27f7495c3180e2Fa238',
          ],
          [
            '0x4144412f55534400000000000000000000000000000000000000000000000000',
            '0xd0b3f3da2561cb442bd0cd5d5be5ada2580cb5b49bdf0e9374d8f8dbfcd5aeb2',
            '0x2E9aA1a0Cb85c0dF938D99b6306c1db66129Bf73',
          ],
        ],
      },
    });
  });

  afterEach(() => {
    cy.task('deleteTreeData', { subfolder });
  });

  describe('signing process', () => {
    beforeEach(() => {});

    it('disables the sign button when the user is not a signer', () => {
      cy.task('seedTreeData', {
        subfolder,
        signerData: {
          hashSigners: ['0x80efDd3bB15F2108C407049C5575490858800D47'],
        },
      });

      visitDapiManagementPage();

      cy.waitUntilWalletIsConnected();
      cy.findByRole('heading', { name: 'dAPI Management Merkle Tree' }).should('be.visible');
      dismissCIToast();
      cy.findByRole('button', { name: 'Sign Root' }).should('be.disabled');
    });

    it('allows a signer to sign the merkle root and updates the ui accordingly on success', () => {
      const existingAccount1Signature =
        '0x5f4117bfe765a81ce3a25a84566eeffb245302f29cb2909b3f1b87991bed11833e0209b9063bf477d7fb542af82b41aafce940ff9d2d89ff589957b5ecc68ade1c';
      cy.task('seedTreeData', {
        subfolder,
        currentHashData: {
          signatures: {
            [account0Address]: 'Ox',
            [account1Address]: existingAccount1Signature,
          },
        },
      });

      visitDapiManagementPage();
      dismissCIToast();

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
        '0xcfc54e2180159f0570b9f51eda42a282140cb97b07d28d80d588362def45a9da44d0236955c7f7bde37d6dd614abc637ca83992df6e9c38686402139d7293ebd1b';

      cy.findByTestId('tree-status-badge').should('have.text', 'Signed');
      cy.findByTestId('signatures-table').within(() => {
        cy.findAllByRole('row').then((rows) => {
          cy.wrap(rows[1]).findByRole('cell', { name: account0Signature });
          cy.wrap(rows[2]).findByRole('cell', { name: existingAccount1Signature });
        });
      });

      cy.findByRole('tab', { name: 'Tree Diff' }).click();
      cy.findByRole('tabpanel', { name: 'Tree Diff' }).within(() => {
        cy.findByText(`"${account0Signature}"`).should('be.visible');
      });
    });

    it('validates and ignores invalid signatures', () => {
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

      visitDapiManagementPage();
      dismissCIToast();

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
        visitDapiManagementPage();
        dismissCIToast();

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

  // TODO
  describe.skip('tree diff', () => {});

  it('informs the user about the CI verification', () => {
    visitDapiManagementPage();

    cy.findByRole('region', { name: 'Notifications (F8)' })
      .should('contain.text', 'The CI verifies the following for you')
      .findByRole('button', { name: 'Got it' })
      .click();

    // The toast should not show again
    cy.reload();
    cy.findByRole('heading', { name: 'dAPI Management Merkle Tree' }).should('be.visible');
    cy.wait(1000);
    cy.findByRole('region', { name: 'Notifications (F8)' }).should(
      'not.contain.text',
      'The CI verifies the following for you'
    );
  });
});

function visitDapiManagementPage() {
  cy.visit('/merkle-trees/dapi-management');
}

function dismissCIToast() {
  cy.findByRole('button', { name: 'Got it' }).click();
}
