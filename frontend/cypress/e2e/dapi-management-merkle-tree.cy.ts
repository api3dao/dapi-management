const subfolder = 'dapi-management-merkle-tree-root';

describe('dAPI Management Merkle tree', () => {
  beforeEach(() => {
    cy.viewport(1630, 1000);
    cy.mockConnectedMetaMaskWallet();

    cy.task('seedTreeData', {
      subfolder,
      signerData: {
        hashSigners: ['0x80efDd3bB15F2108C407049C5575490858800D47', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'],
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
    });
  });

  afterEach(() => {
    cy.task('deleteTreeData', { subfolder });
  });

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
    dismissToast();
    cy.findByRole('button', { name: 'Sign Root' }).should('be.disabled');
  });

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
  cy.visit('http://localhost:3000/merkle-trees/dapi-management');
}

function dismissToast() {
  cy.findByRole('button', { name: 'Got it' }).click();
}
