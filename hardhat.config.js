require('@nomicfoundation/hardhat-toolbox');
const { hardhatConfig } = require('@api3/chains');
require('hardhat-deploy');
require('dotenv').config();

module.exports = {
  etherscan: hardhatConfig.etherscan(),
  networks: hardhatConfig.networks(),
  solidity: {
    compilers: [
      {
        version: '0.8.17',
      },
      {
        version: '0.8.18',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
};
