const hre = require('hardhat');
const {
  getDapiFallbackHashType,
  getDapiManagementHashType,
  getDapiPricingHashType,
  getSignedApiUrlHashType,
} = require('../scripts/utils');
const dapiFallbackHashSigners = require('../data/dapi-fallback-merkle-tree-root/hash-signers.json');
const dapiFallbackCurrentHash = require('../data/dapi-fallback-merkle-tree-root/current-hash.json');
const dapiManagementHashSigners = require('../data/dapi-management-merkle-tree-root/hash-signers.json');
const dapiManagementCurrentHash = require('../data/dapi-management-merkle-tree-root/current-hash.json');
const dapiPricingHashSigners = require('../data/dapi-pricing-merkle-tree-root/hash-signers.json');
const dapiPricingCurrentHash = require('../data/dapi-pricing-merkle-tree-root/current-hash.json');
const signedApiUrlHashSigners = require('../data/signed-api-url-merkle-tree-root/hash-signers.json');
const signedApiUrlCurrentHash = require('../data/signed-api-url-merkle-tree-root/current-hash.json');

async function verify(hashRegistry, hashSigners, hashType, hash, timestamp, signatures) {
  const onChainHashSigners = await hashRegistry.getSigners(hashType);
  if (!hashSigners.every((signer, index) => signer === onChainHashSigners[index])) {
    throw new Error('On-chain signers mismatch');
  }
  const message = hre.ethers.utils.arrayify(
    hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [hashType, hash, timestamp])
  );
  if (
    !onChainHashSigners.every((signer) => {
      const signature = signatures[signer];
      return signature && hre.ethers.utils.verifyMessage(message, signature) === signer;
    })
  ) {
    throw new Error('Signatures mismatch');
  }
  if (hash !== (await hashRegistry.hashTypeToHash(hashType))) {
    throw new Error('Hash mismatch');
  }
}

async function main() {
  const network = process.env.HARDHAT_NETWORK;

  console.log(`Verifying HashRegistry data on ${network}...`);
  try {
    const hashRegistryDeployment = await hre.deployments.getOrNull('HashRegistry');
    if (!hashRegistryDeployment) {
      console.log(`HashRegistry deployment not found on ${network}`);
      return;
    }

    const hashRegistry = await hre.ethers.getContractAt('HashRegistry', hashRegistryDeployment.address);

    console.log(`Verifying dAPI fallback...`);
    await verify(
      hashRegistry,
      dapiFallbackHashSigners.hashSigners,
      getDapiFallbackHashType(),
      dapiFallbackCurrentHash.hash,
      dapiFallbackCurrentHash.timestamp,
      dapiFallbackCurrentHash.signatures
    );

    console.log(`Verifying dAPI management...`);
    await verify(
      hashRegistry,
      dapiManagementHashSigners.hashSigners,
      getDapiManagementHashType(),
      dapiManagementCurrentHash.hash,
      dapiManagementCurrentHash.timestamp,
      dapiManagementCurrentHash.signatures
    );

    console.log(`Verifying dAPI pricing...`);
    await verify(
      hashRegistry,
      dapiPricingHashSigners.hashSigners,
      getDapiPricingHashType(),
      dapiPricingCurrentHash.hash,
      dapiPricingCurrentHash.timestamp,
      dapiPricingCurrentHash.signatures
    );

    console.log(`Verifying signed API URL...`);
    await verify(
      hashRegistry,
      signedApiUrlHashSigners.hashSigners,
      getSignedApiUrlHashType(),
      signedApiUrlCurrentHash.hash,
      signedApiUrlCurrentHash.timestamp,
      signedApiUrlCurrentHash.signatures
    );
  } catch (err) {
    console.log(`HashRegistry verification on ${network} failed`);
    throw err;
  }
  console.log(`HashRegistry verification on ${network} succeeded`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
