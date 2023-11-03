## Usage Of Merkle Tree Signing Scripts

1. Navigate to the respective directory under `data/` corresponding to each Merkle tree. Update the current-hash.json file with the necessary values, ensuring it has the following structure:

```json
{
  "timestamp": 1676940000,
  "hash": "0x1234...",
  "signatures": {
  },
  "merkleTreeValues": {
    "values": [...]
  },
}
```

2. Run the script by specifying the Merkle tree's name and the `chainId` as follows:

```bash
yarn sign [MerkleTreeName] [chainId]
```

For instance, to sign the `dAPI fallback Merkle tree` Merkle tree for a network with a `chainId` of 1, you would use:

```bash
yarn sign "dapi fallback" 1
```

This command constructs the Merkle tree based on the data, signs the root, and updates `current-hash.json` in the specified directory.

3. After running the script, confirm that `current-hash.json` is updated with the new Merkle root and the signature.

## Data File Details

- **current-hash.json:** Stores the state of the Merkle tree. Updated by the script with each execution, recording the new Merkle root, its signature, and the timestamp.

- **hash-signers.json:** Holds addresses that are authorized to sign the Merkle root, ensuring the authenticity of the signatures.

### 1. dAPI pricing Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Chain ID (uint256)**: Identifier for the blockchain network.
  - **dAPI Update Parameters (bytes)**: Parameters associated with the dAPI update.
  - **Duration (uint256)**: The duration for which the price is valid.
  - **Price (uint256)**: The cost in the native currency of the chain. There is no minimum USD price.

### 2. dAPI management Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Beacon Set ID (bytes32)**: Identifier for the beacon set.
  - **dAPI Sponsor Wallet Address (address)**: Wallet address of the dAPI sponsor wallet.

### 3. dAPI fallback Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: The name of the dAPI, hashed.
  - **Beacon ID (bytes32)**: Identifier for the Beacon.
  - **Sponsor Wallet Address (address)**: Address of the sponsor wallet.

### 4. Signed API URL Merkle Tree

- **Values**:
  - **Airnode Address (address)**: The contract address of the Airnode.
  - **Signed API URL (bytes32)**: The signed URL of the API. Verified by referring to the DNS records of the base URL.

## Merkle Tree Types

In the context of this tool, each Merkle tree is associated with a unique type. This type is not arbitrarily assigned but is derived from the tree's identifiable name using a deterministic algorithm.

The following code snippet shows how we derive the type of Signed API URL Merkle Tree:

```js
keccak256(abi.encodePacked('Signed API URL Merkle tree root'));
```

## Usage Of Update DApi Fallback hash

1. Run the script by specifying the Merkle tree's name as follows:

```bash
yarn update:dapi-fallback [MerkleTreeName]
```

For instance, to update the current-hash fo `dAPI fallback Merkle tree` Merkle tree, you would use:

```bash
yarn update:dapi-fallback "dapi fallback"
```

This command checks the values in `current-hash.json` and compares it with what `@nodary/utilities` has. If they are not equal
It saves the `current-hash.json` to `previous-hash.json` and updates `current-hash.json` with the new values.
