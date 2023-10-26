# DapiFallbackV1

## Roles: Root signers and dAPI fallback executors

DapiFallbackV1 does not use AccessControlRegistry to manage its roles. Instead, it's an Ownable contract, which is
intended to be owned by the OwnableCallForwarder (which is intended to be owner by the manager multisig). In addition,
it maintains two lists of account addresses, "root signers" and "dAPI fallback executors". The owner is authorized to
update both of these lists by calling `setRootSigners()` and `setDapiFallbackExecutors()`, respectively.

Only Merkle tree roots that are signed by all the current root signers are usable in DapiFallbackV1. Any one of the
current dAPI fallback executors can use a signed Merkle tree root to execute a dAPI fallback by calling DapiFallbackV1.

## Instructions to set the contract up

Mertcan maintains an API endpoint that returns the following data from the production database:

```
{"success":true,"result":{"marketPrices":{"1":{"value":0.12608496901669472,"unit":"ether"},"10":{"value":0.01827904605961956,"unit":"ether"},"30":{"value":0.000449911875,"unit":"ether"},"56":{"value":0.025270704880395,"unit":"ether"},"100":{"value":0.01821379095991,"unit":"ether"},"137":{"value":1.025051008056205,"unit":"ether"},"250":{"value":15.288910830164074,"unit":"ether"},"1101":{"value":0.011433373513817142,"unit":"ether"},"1284":{"value":1.2367427726494966,"unit":"ether"},"1285":{"value":0.011782495328218333,"unit":"ether"},"2222":{"value":0.0064273125,"unit":"ether"},"5000":{"value":5.25,"unit":"ether"},"8453":{"value":0.0105,"unit":"ether"},"42161":{"value":0.011480184550224835,"unit":"ether"},"43114":{"value":0.23521472559288167,"unit":"ether"},"59144":{"value":0.0105,"unit":"ether"}},"livePrices":{"1":{"value":0.06344462713966548,"unit":"ether"},"10":{"value":0.006897220139842539,"unit":"ether"},"30":{"value":0.0005261644513066667,"unit":"ether"},"56":{"value":0.022533744073698667,"unit":"ether"},"100":{"value":0.017905626334288,"unit":"ether"},"137":{"value":0.8377517010140318,"unit":"ether"},"250":{"value":0.9832481405137626,"unit":"ether"},"1101":{"value":0.003824004517328571,"unit":"ether"},"1284":{"value":1.2598075094941281,"unit":"ether"},"1285":{"value":0.010093230719992,"unit":"ether"},"2222":{"value":0.008073333333333333,"unit":"ether"},"5000":{"value":2.8943787515376904,"unit":"ether"},"8453":{"value":0.007861111965223141,"unit":"ether"},"42161":{"value":0.005978649418891264,"unit":"ether"},"43114":{"value":0.20220856983417065,"unit":"ether"},"59144":{"value":0.006719554276138667,"unit":"ether"}}}}
```

These are the "exotic" (i.e., the ones that are expected to update most frequently, ~36 times a day) dAPI prices divided
by the subscription period to get the daily price. `marketPrices` is the manually reviewed prices that appear on the
market (we'll use this). `livePrices` is the automatic estimation based on the most recent gas price records (this is to
ensure that the market prices are not completely off).

Run the following script to update [metadata.json](./data/metadata.json) with market prices. You can get `API_KEY` from
Mertcan. Note that this API is not trusted and you must confirm the sanity of the values manually.

```sh
API_KEY=... node chain/fallback/scripts/update-metadata-with-api.js
```

<!-- markdown-link-check-disable -->

This will update `chain/fallback/data/metadata.json` by adding new chain entries and updating existing ones. You're
recommended to revert the changes to existing chain entries unless they're significantly different (because gas prices
on that chain has increased a lot for example). This is because updating an existing minimum sponsor wallet balance is
very cumbersome, you would need to deploy a new MerkleFunderDepository with the updated Merkle tree, have the manager
multisig call DapiFallbackV1 to update the minimum sponsor wallet balance, have the manager multisig transfer the funds
from the old MerkleFunderDepository to the new one, and redeploy the Merkle funder worker. (See
https://github.com/api3dao/manager-multisig/pull/266 for an example where the minimum sponsor wallet balance values for
existing DapiFallbackV1 contarcts being changed.)

Then, assuming that you haven't updated any existing entries, for the chains for which new entries are made, run the
following for all the chains

```sh
NETWORK=... yarn eth:deploy-fallback
```

Then, you need to update the Merkle funder metadata, update the deployment and deploy the new MerkleFunderDepository
contracts. See [here](../merkle-funder/README.md) for details.

Then, run the following for all the chains to set the minimum sponsor wallet balances and transfer the ownership of the
DapiFallbackV1 contracts to OwnableCallForwarder

```sh
NETWORK=... yarn eth:fund-fallback
```

Finally, have the manager multisig create and grant the respective dAPI name setter role to the DapiFallbackV1
contracts. See https://github.com/api3dao/manager-multisig/pull/254 as an example.

<!-- markdown-link-check-enable -->

## Localhost demo

Start at repo root. Leave the local node running on one terminal

```
yarn eth:node
```

Open another terminal, run

```
NETWORK=localhost yarn eth:deploy-fallback
```

Go to `chain/`

```
cd chain
```

Run

```
npx hardhat run ./fallback/scripts/execute-fallbacks.js --network localhost
```
