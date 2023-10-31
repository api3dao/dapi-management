# @api3/dapi-management

## Contracts

### HashRegistry

This contract is intended to be used as a generic hash registry. Users of this contract are expected to register hashes that must be previously signed by a group of signer accounts. These signers must sign a hash type, a hash and a timestamp

The signers list for a hash type is managed by an owner account but anyone can register a new hash for a hash type if all valid signatures are provided. One thing to keep in mind is that signatures must be sent in the same order as the signers list stored in the contract. This requires that off-chain signing workflow keeps up-to-date with signers removal calls made to the contract since this type of calls might change the order of the signers

This contract is specially useful for use cases where other contracts need to make sure a set of data is valid and it is up-to-date. For example, in the case of a Airnode Signed API URLs, there will be a merkle tree containing all the Airnode address and URL pairs. Then a group of trusted signers could verify that this data is correct and sign the root of this merkle tree. Then this root can be registered in the HashRegistry. Any other contract can then receive a Signed API URL for an Airnode and check that it is valid and that it is the most up-to-date one by retrieving the hash and timestamp from the registry
