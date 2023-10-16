# @api3/dapi-management

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

2. Run the script with the desired Merkle tree name:

```bash
yarn sign [MerkleTreeName]
```

For example, to sign the `priceMT` Merkle tree:

```bash
yarn sign priceMT
```

The script will construct the Merkle tree, sign it, and update the `metadata.json` file with the Merkle root and the signature.

3. Check the `metadata.json` file in the `data` directory to see the updated Merkle root and signature.

## Understanding the `metadata.json` Fields

The `metadata.json` file contains various Merkle trees, each with its unique set of values. Here's a breakdown of each Merkle tree and its associated values:

### 1. Price Merkle Tree

- **Values**:
  - **dAPI Name (string)**: The name of the dAPI.
  - **Chain ID (uint256)**: Identifier for the blockchain network.
  - **dAPI Update Parameters (bytes32)**: Parameters associated with the dAPI update.
  - **Duration (uint256)**: The duration for which the price is valid.
  - **Price (uint256)**: The cost in the native currency of the chain. There is no minimum USD price.

### 2. dapiManagement Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI.
  - **Beacon Set ID (bytes32)**: Identifier for the beacon set.
  - **dAPI Sponsor Wallet Address (address)**: Wallet address of the dAPI sponsor wallet.

### 3. dapiFallback Merkle Tree

- **Values**:
  - **dAPI Name (string)**: The name of the dAPI.
  - **Nodary Beacon ID (bytes32)**: Identifier for the Nodary Beacon.
  - **Nodary Sponsor Wallet Address (address)**: Wallet address of the Nodary sponsor wallet.

### 4. apiIntegration Merkle Tree

- **Values**:
  - **Airnode Address (address)**: The contract address of the Airnode.
  - **OIS Title (bytes32)**: Title of the OIS.
  - **Signed API URL (string)**: The signed URL of the API, verified by referring to the DNS records of the base URL.

Make sure to structure the `metadata.json` file appropriately, keeping in mind the specific values and their purposes for each Merkle tree.
