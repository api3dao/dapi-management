# @api3/dapi-management

## Contracts

### HashRegistry

This contract is intended to be used as a generic hash registry. Users of this contract are expected to register hashes that must be previously signed by a group of signer accounts. These signers must sign a hash type, a hash and a timestamp

The signers list for a hash type is managed by an owner account but anyone can register a new hash for a hash type if all valid signatures are provided. One thing to keep in mind is that signatures must be sent in the same order as the signers list stored in the contract. This requires that off-chain signing workflow keeps up-to-date with signers removal calls made to the contract since this type of calls might change the order of the signers

This contract is specially useful for use cases where other contracts need to make sure a set of data is valid and it is up-to-date. For example, in the case of a Airnode Signed API URLs, there will be a merkle tree containing all the Airnode address and URL pairs. Then a group of trusted signers could verify that this data is correct and sign the root of this merkle tree. Then this root can be registered in the HashRegistry. Any other contract can then receive a Signed API URL for an Airnode and check that it is valid and that it is the most up-to-date one by retrieving the hash and timestamp from the registry

## Setup

1. Install dependencies using `yarn`:

```bash
yarn install
```

2. Set up your environment variables. Create a `.env` file in the root directory and add your mnemonic:

```
MNEMONIC=YOUR_MNEMONIC_HERE
```

## Usage

1. Update the `metadata.json` file located in the `data` directory with the required values for your Merkle tree. The structure of `metadata.json` should look like this:

```json
{
  "rootSigners": [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    ...
  ],
  "merkleTrees": {
    "priceMT": {
      "timestamp": 1676940000,
      "values": [...],
      "merkleRoot": "",
      "signatures": {}
    },
    ...
  }
}
```

Each Merkle tree inside the `merkleTrees` object should have a timestamp, values array, merkleRoot, and signatures object.

2. Run the script by specifying the Merkle tree's name and the `chainId` as follows:

```bash
yarn sign [MerkleTreeName] [chainId]
```

For instance, to sign the `priceMT` Merkle tree for a network with a `chainId` of 1, you would use:

```bash
yarn sign priceMT 1
```

The script will construct the Merkle tree, sign it, and update the `metadata.json` file with the Merkle root and the signature.

3. Check the `metadata.json` file in the `data` directory to see the updated Merkle root and signature.

## Understanding the `metadata.json` Fields

The `metadata.json` file contains various Merkle trees, each with its unique set of values. Here's a breakdown of each Merkle tree and its associated values:

### 1. Price Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Chain ID (uint256)**: Identifier for the blockchain network.
  - **dAPI Update Parameters (bytes)**: Parameters associated with the dAPI update.
  - **Duration (uint256)**: The duration for which the price is valid.
  - **Price (uint256)**: The cost in the native currency of the chain. There is no minimum USD price.

### 2. dapiManagement Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Beacon Set ID (bytes32)**: Identifier for the beacon set.
  - **dAPI Sponsor Wallet Address (address)**: Wallet address of the dAPI sponsor wallet.

### 3. dapiFallback Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Nodary Beacon ID (bytes32)**: Identifier for the Nodary Beacon.
  - **Nodary Sponsor Wallet Address (address)**: Wallet address of the Nodary sponsor wallet.

### 4. apiIntegration Merkle Tree

- **Values**:
  - **Airnode Address (address)**: The contract address of the Airnode.
  - **Signed API URL (bytes32)**: The signed URL of the API, hashed. Verified by referring to the DNS records of the base URL.

Make sure to structure the `metadata.json` file appropriately, keeping in mind the specific values and their purposes for each Merkle tree.
