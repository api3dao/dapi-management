## Data File Details

- **current-hash.json:** Stores the state of the Merkle tree. Updated by the script with each execution, recording the new Merkle root, signatures, and the timestamp.

- **previous-hash.json:** Stores the state of the previous Merkle tree. This is used to present the user with a diff view between the previous and current states.

- **hash-signers.json:** Holds addresses that are authorized to sign the Merkle root, ensuring the authenticity of the signatures.

### 1. dAPI pricing Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: dAPI name string formatted as bytes32.
  - **Chain ID (uint256)**: Identifier for the blockchain network.
  - **dAPI Update Parameters (bytes)**: Encoded parameters for dAPI updates. It decodes as, Deviation Threshold in Percentage (uint256) [multiplied by 1e6](https://github.com/api3dao/airnode-protocol-v1/blob/b45d225ef33257d82124dd895731846bc7e46eed/contracts/api3-server-v1/extensions/BeaconSetUpdatesWithPsp.sol#L27), Deviation Reference (int224), Heartbeat Interval (uint32) in seconds.
  - **Duration (uint256)**: Subscription duration in seconds.
  - **Price (uint256)**: The cost in the native currency of the chain, expressed in wei.

### 2. dAPI management Merkle Tree

- **Values**:
  - **dAPI Name (bytes32)**: dAPI name string formatted as bytes32.
  - **Data Feed ID (bytes32)**: Identifier for the data feed.
  - **dAPI Sponsor Wallet Address (address)**: Wallet address of the dAPI sponsor wallet.

### 3. Signed API URL Merkle Tree

- **Values**:
  - **Airnode Address (address)**: The contract address of the Airnode.
  - **Signed API URL (string)**: The signed URL of the API. Verified by referring to the DNS records of the base URL.

## Merkle Tree Types

In the context of this tool, each Merkle tree is associated with a unique type. This type is not arbitrarily assigned but is derived from the tree's identifiable name using a deterministic algorithm.

The following code snippet shows how we derive the type of Signed API URL Merkle Tree:

```js
keccak256(abi.encodePacked('Signed API URL Merkle tree root'));
```

## Data Verification

See [documentation](verification/README.md)
