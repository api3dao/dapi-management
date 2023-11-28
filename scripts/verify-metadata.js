const { spawn } = require('child_process');
const references = require('../deployments/references.json');

async function main() {
  for (const [chainId, exports] of Object.entries(references)) {
    const network = exports.find((e) => e.chainId === chainId).name;

    const childProcess = spawn('node', ['./scripts/verify-hash-registry.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        HARDHAT_NETWORK: network,
      },
    });

    childProcess.on('close', (code) => {
      console.log(`Child process exited with code ${code}`);
      process.exitCode = code;
    });

    childProcess.on('error', (err) => {
      throw err;
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
