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

## dAPI Pricing Merkle Tree Generation Script Details

Before running the script, add database connection credentials in `/.env` (you can get these values from Vekil or Aaron):

```shell
DATABASE_HOST=
DATABASE_PORT=
DATABASE_NAME=
DATABASE_USER=
DATABASE_PASSWORD=
```

Run the script with:

```shell
node scripts/generate-dapi-pricing-mt.js
```

This script generates the dAPI pricing merkle tree by connecting to the `data-collectors` database and querying for three sets of data:

1. The average daily update count for all `BeaconSets` found in `/data/dapis.json`. These are calculated from data fetched from each provider's Signed API.
2. The average chain gas prices from data collected by the gas collectors.
3. The gas cost of a single BeaconSet update on each chain. The script file contains gas cost formulas for each chain.

Finally, dAPI prices and the pricing merkle tree is generated.

Configure the script parameters in `/scripts/dapi-pricing-parameters.json` and make sure to commit the changes for the script results to be replicable by others.

The config contains these fields.

- `startDate`: calculation start date
- `endDate`: calculation end date.
- `updateCountOptions`: the Airseeker configurations (`deviationThreshold` and `heartbeatInterval`) to calculate update counts for.
- `updateCountCheckFrequency`: the frequency to check signed data for exceeding deviations, in seconds.
- `defaultSingleUpdateGasCost`: the default fixed gas cost.
- `defaultGasMultiplier`: the default chain gas multiplier (up to two decimals) to use for chains not defined in `chainGasMultipliers`.
- `defaultSubscriptionDuration`: the default subscription period to use for chains not defined in `chainSubscriptionDurations`, in days.
- `chainSubscriptionDurations`: chain specific subscription durations, in days.
- `chainGasMultipliers`: chain specific gas multipliers (up to two decimlas).
- `chainSingleUpdateGasCosts`: chain specific single update costs including layer 1 and layer 2 values.
- `chainIdToGasOracleContractAddress`: the address of a chain's gas oracle contract (must be defined for `optimism`-style chains).
- `chainNativeTokenPrices`: The token prices for `Mantle` and `Ethereum`, in USD.

## Data Verification

See [documentation](verification/README.md)
