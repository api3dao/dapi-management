require('@nomicfoundation/hardhat-toolbox');
const { hardhatConfig } = require('@api3/chains');
require('dotenv').config();

module.exports = {
  etherscan: hardhatConfig.etherscan(),
  networks: hardhatConfig.networks(),
  solidity: {
    version: '0.8.18',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};
