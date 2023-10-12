const fs = require('fs');
const path = require('path');
const { signEIP712Message, constructMerkleTree } = require('./merkle-utils');
const ethers = require('ethers');

// Reading the input data
const inputData = JSON.parse(fs.readFileSync(path.join(__dirname, 'treeValues', 'dapiFallbackMT.json'), 'utf8'));
const values = inputData.values;

const tree = constructMerkleTree(values, ["string", "bytes32", "address"]);
const merkleRoot = tree.root;

// Derive hashType from the merkle tree's name
const merkleTreeName = 'dapiFallbackMT';
const hashType = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(merkleTreeName));

const outputDir = path.join(__dirname, 'signatures');
const outputPath = path.join(outputDir, 'dapiFallbackMT.json');

// Get the timestamp from inputData
const timestamp = inputData.timestamp;

if (!timestamp) {
    throw new Error('Timestamp not provided in input data');
}

(async () => {
    const signature = await signEIP712Message(hashType, merkleRoot, timestamp);
    const signerAddress = ethers.Wallet.fromMnemonic(process.env.MNEMONIC).address;

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    let output;
    if (fs.existsSync(outputPath)) {
        output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        output.signatures = output.signatures || {};
        output.signatures[signerAddress] = signature;
    } else {
        output = {
            merkleRoot: merkleRoot,
            timestamp: timestamp,
            signatures: {
                [signerAddress]: signature
            }
        };
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 4));
})();
