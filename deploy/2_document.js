const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const currentReferences = require('../deployments/references.json');

module.exports = async () => {
  const network = process.env.HARDHAT_NETWORK || hre.network.name;
  if (network === 'hardhat' || network === 'localhost') {
    return;
  }

  const chainId = await hre.getChainId(); // Function added to runtime by hardhat-deploy plugin
  const references = currentReferences;
  references.chainNames = {
    ...currentReferences.chainNames,
    [chainId]: network,
  };
  const deploymentBlockNumbers = { chainNames: references.chainNames };

  for (const contractName of ['HashRegistry', 'DapiFallbackV2', 'DapiDataRegistry', 'Api3Market']) {
    references[contractName] = {};
    deploymentBlockNumbers[contractName] = {};
    for (const [chainId] of Object.entries(references.chainNames)) {
      const deployment = await hre.deployments.get(contractName); // deployments object is also added by hardhat-deploy plugin
      references[contractName][chainId] = deployment.address;
      if (deployment.receipt) {
        deploymentBlockNumbers[contractName][chainId] = deployment.receipt.blockNumber;
      } else {
        deploymentBlockNumbers[contractName][chainId] = 'MISSING';
      }
    }
  }

  fs.writeFileSync(path.join('deployments', 'references.json'), JSON.stringify(references, null, 2));
  fs.writeFileSync(
    path.join('deployments', 'deployment-block-numbers.json'),
    JSON.stringify(deploymentBlockNumbers, null, 2)
  );
};

module.exports.tags = ['document'];
