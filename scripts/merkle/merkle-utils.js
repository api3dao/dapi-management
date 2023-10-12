const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { ethers } = require('ethers');
require('dotenv').config();

const mnemonic = process.env.MNEMONIC;
const wallet = ethers.Wallet.fromMnemonic(mnemonic);

const domain = {
    name: "TimestampedHashRegistry",
    version: "1.0.0",
    chainId: 1,
    verifyingContract: "0x0000000000000000000000000000000000000000"
};

const types = {
    SignedHash: [
        { name: "hashType", type: "bytes32" },
        { name: "hash", type: "bytes32" },
        { name: "timestamp", type: "uint256" }
    ]
};

async function signEIP712Message(hashType, hash, timestamp) {
    const message = {
        hashType: hashType,
        hash: hash,
        timestamp: timestamp
    };

    const signature = await wallet._signTypedData(domain, types, message);
    return signature;
}

function constructMerkleTree(values, dataTypes) {
    return StandardMerkleTree.of(values, dataTypes);
}

module.exports = { signEIP712Message, constructMerkleTree };
