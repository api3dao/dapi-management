const hre = require('hardhat');
const {
  getDapiFallbackHashType,
  getDapiManagementHashType,
  getDapiPricingHashType,
  getSignedApiUrlHashType,
} = require('../scripts/utils');
const dapiFallbackHashSigners = require('../data/dapi-fallback-merkle-tree-root/hash-signers.json');
const dapiManagementHashSigners = require('../data/dapi-management-merkle-tree-root/hash-signers.json');
const dapiPricingHashSigners = require('../data/dapi-pricing-merkle-tree-root/hash-signers.json');
const signedApiUrlHashSigners = require('../data/signed-api-url-merkle-tree-root/hash-signers.json');

async function main() {
  const network = process.env.HARDHAT_NETWORK;
  // console.log(
  //   '🚀 ~ file: verify-metadata.js:9 ~ main ~ deployments.all():',
  //   Object.entries(await hre.deployments.all()).map(([name, d]) => ({ name, address: d.address }))
  // );
  console.log(`Verifying hash signers on ${network}...`);
  try {
    const hashRegistryDeployment = await hre.deployments.getOrNull('HashRegistry');
    if (!hashRegistryDeployment) {
      console.log(`HashRegistry deployment not found on ${network}`);
      return;
    }

    const hashRegistry = await hre.ethers.getContractAt('HashRegistry', hashRegistryDeployment.address);

    let signers = await hashRegistry.getSigners(getDapiFallbackHashType());
    if (!dapiFallbackHashSigners.hashSigners.every((signer, index) => signer === signers[index])) {
      throw new Error('dapiFallbackHashSigners mismatch');
    }

    signers = await hashRegistry.getSigners(getDapiManagementHashType());
    if (!dapiManagementHashSigners.hashSigners.every((signer, index) => signer === signers[index])) {
      throw new Error('dapiFallbackHashSigners mismatch');
    }

    signers = await hashRegistry.getSigners(getDapiPricingHashType());
    if (!dapiPricingHashSigners.hashSigners.every((signer, index) => signer === signers[index])) {
      throw new Error('dapiFallbackHashSigners mismatch');
    }

    signers = await hashRegistry.getSigners(getSignedApiUrlHashType());
    if (!signedApiUrlHashSigners.hashSigners.every((signer, index) => signer === signers[index])) {
      throw new Error('dapiFallbackHashSigners mismatch');
    }
  } catch (err) {
    console.log(`Hash signers verification on ${network} failed`);
    throw err;
  }

  console.log(`Hash signers verification on ${network} succeeded`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
