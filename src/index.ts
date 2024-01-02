import dapis from '../data/dapis.json';
import supportedChainIds from './generated/supported-chains.json';
import * as api3Chains from '@api3/chains';
import * as api3Integrations from '@api3/api-integrations';

function supportedChains() {
  return supportedChainIds
    .map((alias) => {
      const chain = api3Chains.CHAINS.find((chain) => chain.alias === alias);
      if (!chain) {
        throw new Error(`Chain ${alias} does not exist`);
      }
      return chain.id;
    })
    .sort((a, b) => parseInt(a) - parseInt(b));
}

export { dapis, supportedChains, api3Chains, api3Integrations };
