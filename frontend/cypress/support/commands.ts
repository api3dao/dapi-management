/* eslint-disable @typescript-eslint/no-explicit-any */
// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

import { providers } from 'ethers';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mockConnectedMetaMaskWallet(options?: { accountIndex: number }): Chainable<void>;
      waitUntilWalletIsConnected(): Chainable<void>;
    }
  }
}

const ethersProvider = new providers.JsonRpcProvider('http://localhost:8545');

Cypress.Commands.add('mockConnectedMetaMaskWallet', (options = { accountIndex: 0 }) => {
  const { accountIndex } = options;
  cy.on('window:before:load', async (win) => {
    // The `request` function is defined when we use MetaMask, so we mock it
    (ethersProvider as any).request = ({ method, params }) => {
      if (method === 'eth_requestAccounts') {
        method = 'eth_accounts';
      }
      return ethersProvider.send(method, params).then((res) => {
        if (method === 'eth_accounts' && accountIndex > 0) {
          return res.slice(accountIndex, res.length);
        }
        return res;
      });
    };
    // Simulate injected metamask provider
    (win as any).ethereum = ethersProvider;
  });
});

Cypress.Commands.add('waitUntilWalletIsConnected', () => {
  cy.findByTestId('connected-wallet-address').should('be.visible');
});
