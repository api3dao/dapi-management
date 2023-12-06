const { spawnSync } = require('child_process');
const references = require('../deployments/references.json');
const { verifyData: verifyDapiManagementData } = require('./verification/verify-dapi-management-data');
const { verifyData: verifyDapiPricingData } = require('./verification/verify-dapi-pricing-data');
const { verifyData: verifySignedApiUrlData } = require('./verification/verify-signed-api-url-data');

function runChildProcess(network) {
  const result = spawnSync('node', ['./scripts/verify-hash-registry.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARDHAT_NETWORK: network,
    },
    encoding: 'utf-8', // Set encoding to capture stdout and stderr as strings
  });

  return result.status; // Exit code of the child process
}

async function main() {
  // Verify merkle tree data locally
  verifyDapiManagementData();
  verifyDapiPricingData();
  verifySignedApiUrlData();

  // Verify merkle tree data against HashRegistry contracts
  for (const [chainId, exports] of Object.entries(references)) {
    const network = exports.find((e) => e.chainId === chainId).name;

    const exitCode = runChildProcess(network);

    console.log(`Child process exited with code ${exitCode}`);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break; // Exit the loop if any child process fails
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
