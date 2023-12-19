# @api3/dapi-management

Tools and contracts that enable running managed dAPIs where most of the data needed to accomplish this is stored on-chain.

In order to be able to make this possible, there needs to be different groups of "data owners" that will provide, review and sign specific sets of data. Other accounts need to provide and sign dAPI prices for different chains and so on.

These signed data sets (Merkle trees) will be stored in JSON files in this repo and can later be used by people with the right roles or permits to use it when calling functions on the contracts datailed below. This repo also provides a frontend app that can be used as interface between the mentioned JSON files and the contracts.

## Contracts

### HashRegistry

This contract is intended to be used as a generic hash registry. Users of this contract are expected to register hashes that must be previously signed by a group of signer accounts. These signers must sign a hash type, a hash and a timestamp.

The signers list for a hash type is managed by an owner account but anyone can register a new hash for a hash type, provided all signatures are valid and up-to-date. One thing to keep in mind is that signatures must be sent in the same order as the signers list stored in the contract. This requires that off-chain signing workflow keeps up-to-date with signers removal calls made to the contract since this type of calls might change the order of the signers.

This contract is specially useful for use cases where other contracts need to make sure a set of data is valid and it is up-to-date. For example, in the case of a Airnode Signed API URLs, there will be a Merkle tree containing all the Airnode address and URL pairs. Then a group of trusted signers could verify that this data is correct and sign the root of this Merkle tree. Then this root can be registered in the HashRegistry. Any other contract can then receive a Signed API URL for an Airnode and check that it is valid and that it is the most up-to-date one by retrieving the hash and timestamp from the registry.

### DapiDataRegistry

This contract allows to store the list of active dAPIs plus the data need it in order to be able to update the underlying data feeds.

This data is composed of:

1. **Airnode Signed API URLs:** these are used to fetch the off-chain value for a data feed. This is allowed to be updated by anyone that has access to the correct signed Merkle tree data.
1. **Data feed data:** this is basically an ABI encoded list of Airnode addresses and templateIds that is used to derive [beacon](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/DataFeedServer.sol#L87) and [beaconSet](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/DataFeedServer.sol#L98) IDs. This data can be modified by anyone because the data feed ID (beacon or beaconSet) is derived from the provided values and different data would result in different IDs.
1. **List of dAPI names and update parameters:** these dAPI names point to the data feed that must be updated and are considered as "active". This list requires the caller that wants to change this list needs to first be granted specific set of roles to be able to modify it. The caller can also update the update parameters values used as conditions to determine if and when to update a data feed (deviation threshold, heartbeat invetval, etc). One other thing to keep in mind is that since this contract changes the dAPI name to data feed ID mapping in the Api3ServerV1 contract, callers wishing to modify this list must be granted the [dAPI name setter](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/DapiServer.sol#L26) role.

This contract also provides convenience functions to allow callers to read the dAPI names with their related data in a single call or via multicall since the contract inherits from [SelfMulticall.sol](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/utils/SelfMulticall.sol)

### Api3Market

This contract ties everything together. It relies on the previously mentioned contracts to allow the caller to buy a subscription for a managed dAPI based on update conditions for a specific period.

1. It uses DapiFallbackV2.sol to prevent from buying a dAPI that has been set to fallback.
1. It uses HashRegistry.sol to verify if the data from the Merkle trees has been signed by the required accounts and to confirm that the data is valid.
1. It uses DapiDataRegistry.sol to set the dAPI as active and store all the information required for updating the data feed (Signed API URLs, data feed data and update parameters).

The contract is expected to receive the payment based on the price from the pricing Merkle tree but depending if the purchase is:

1. a new managed dAPI
1. an upgrade
1. a future downgrade
1. an extension of a current managed dAPI

then the total amount to be paid may differ from the original amount and the difference will be returned to the caller. The actual payment will be redirected to sponsor wallet in charge of keeping the data feed up-to-date.

In the same transaction while making a purchase, the contract will also try to [deploy a DapiProxy contract](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/proxies/ProxyFactory.sol#L48) that can be used for reading the current value of a data feed and it will also try to update the underlying data feed values with signed data (stored in [Api3ServerV1](https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/DataFeedServer.sol#L27)) if it hasn't been updated recently.

## Local development

Local ETH node can be started and get all deployment scripts to be executed by running this command:

```sh
yarn run node-deploy

```

Alternatively you could do this in separate steps. First start a local running ETH node by running the following command:

```sh
yarn run node

```

Then deploy the contracts by running this command on a new terminal:

```sh
HARDHAT_NETWORK=localhost yarn run deploy

```

Keep in mind that both `localhost` and `hardhat` chains, will not be added to references.json file.
