# Data Verification

The `scripts/verify-data.js` script verifies all merkle tree data and has two distinct parts.

## Part 1: Verify all merkle tree data (before `HashRegistry` checks)

For each current merkle tree (`current-hash.json`) we assert that:

- the `hash` value matches the constructed merkle tree root
- the `signatures` keys match the hash signers exactly (from `hash-signers.json`). The order of the `signatures` keys must match the order of the hash signers, otherwise the assertion fails
- all signatures are valid

### dAPI Management Merkle tree

Additional assertions include that:

- all Data Feed IDs are derived from the dAPI Name and corresponding API Providers
- all Sponsor Wallet addresses are derived from the dAPI Name
- the `hash` value from `previous-hash.json` matches the constructed merkle tree root

### Signed API URL Merkle tree

Additional assertions include that:

- we have API Providers (in the `@api3/api-integrations` package) for all Airnode addresses
- the `hash` value from `previous-hash.json` matches the constructed merkle tree root

## Part 2: Verify all merkle tree data against the deployed `HashRegistry` contracts

For each deployed `HashRegistry` contract, we assert (for each current merkle tree) that:

- the `hash` matches the on-chain hash (i.e. the registered hash)
- the hash signers (from `hash-signers.json`) matches the on-chain signers
