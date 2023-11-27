const {
  getDapiFallbackHashType,
  getDapiManagementHashType,
  getDapiPricingHashType,
  getSignedApiUrlHashType,
} = require('../scripts/utils');
const { hashSigners: dapiFallbackHashSigners } = require('../data/dapi-fallback-merkle-tree-root/hash-signers.json');
const {
  hashSigners: dapiManagementHashSigners,
} = require('../data/dapi-management-merkle-tree-root/hash-signers.json');
const { hashSigners: dapiPricingHashSigners } = require('../data/dapi-pricing-merkle-tree-root/hash-signers.json');
const { hashSigners: signedApiUrlHashSigners } = require('../data/signed-api-url-merkle-tree-root/hash-signers.json');

module.exports = async ({ deployments, getUnnamedAccounts, ethers, network }) => {
  if (network === 'hardhat' || network === 'localhost') {
    return;
  }

  const [, owner] = await getUnnamedAccounts();

  const hashRegistryDeployment = await deployments.get('HashRegistry');
  const hashRegistry = await ethers.getContractAt(
    'HashRegistry',
    hashRegistryDeployment.address,
    await ethers.getSigner(owner)
  );

  await hashRegistry.setupSigners(getDapiFallbackHashType(), dapiFallbackHashSigners);
  await hashRegistry.setupSigners(getDapiManagementHashType(), dapiManagementHashSigners);
  await hashRegistry.setupSigners(getDapiPricingHashType(), dapiPricingHashSigners);
  await hashRegistry.setupSigners(getSignedApiUrlHashType(), signedApiUrlHashSigners);
};

module.exports.tags = ['hash-signers'];
