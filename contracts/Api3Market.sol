// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxyFactory.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IApi3Market.sol";
import "./interfaces/IDapiDataRegistry.sol";
import "./interfaces/IHashRegistry.sol";

/// @title
/// @notice
contract Api3Market is IApi3Market {
    bytes32 private constant DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI pricing Merkle tree root"));

    /// @notice HashRegistry contract address
    address public immutable override hashRegistry;
    /// @notice DapiDataRegistry contract address
    address public immutable override dapiDataRegistry;
    /// @notice ProxyFactory contract address
    address public immutable override proxyFactory;
    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;

    /// @param _hashRegistry HashRegistry contract address
    /// @param _dapiDataRegistry DapiDataRegistry contract address
    /// @param _proxyFactory ProxyFactory contract address
    /// @param _api3ServerV1 Api3ServerV1 contract address
    constructor(
        address _hashRegistry,
        address _dapiDataRegistry,
        address _proxyFactory,
        address _api3ServerV1
    ) {
        require(_hashRegistry != address(0), "HashRegistry address is zero");
        require(
            _dapiDataRegistry != address(0),
            "DapiDataRegistry address is zero"
        );
        require(_proxyFactory != address(0), "ProxyFactory address is zero");
        require(_api3ServerV1 != address(0), "Api3ServerV1 address is zero");
        hashRegistry = _hashRegistry;
        dapiDataRegistry = _dapiDataRegistry;
        proxyFactory = _proxyFactory;
        api3ServerV1 = _api3ServerV1;
    }

    // This function must use the 3 Merkle trees to store the data needed for running a managed dAPI
    function buyDapi(BuyDapiArgs calldata args) external payable override {
        // Store Signed API URLs for all the Airnodes used by the constituent beacons of the beaconSet
        require(
            args.airnodes.length == args.urls.length &&
                args.urls.length == args.signedApiUrlProofs.length,
            "Airondes, URLs or Signed API URL proofs length mismatch"
        );
        for (uint ind = 0; ind < args.signedApiUrlProofs.length; ind++) {
            // TODO: This is very naive and does not check if url being registered is the same for the current airnode
            //       Should we add that check to avoid re-setting the same value to state if values are equal?
            IDapiDataRegistry(dapiDataRegistry).registerAirnodeSignedApiUrl(
                args.airnodes[ind],
                args.urls[ind],
                args.signedApiUrlRoot,
                args.signedApiUrlProofs[ind]
            );
        }

        // Store the actual data used to derive each beaconId that will then be used to derive the beaconSetId
        require(
            args.airnodes.length == args.templateIds.length,
            "Airnodes and template IDs length mismatch"
        );
        // TODO: dAPI purchases will always use beaconSets or will there be purchases that will point to a single beacon?
        IDapiDataRegistry(dapiDataRegistry).registerDataFeed(
            abi.encode(args.airnodes, args.templateIds)
        );

        // Store the dAPI name along with the update parameters used by AirseekerV2
        // TODO: handle downgrade/upgrade
        //       say we have 0.25% active for the next 3 months and someone wants
        //       to come in and buy 1% for the next 6 months, which means they
        //       should only pay for 1% for 3 months and the dAPI to be
        //       downgraded to 1% after 3 months
        (
            uint256 deviationThresholdInPercentage,
            int224 deviationReference,
            uint32 heartbeatInterval
        ) = abi.decode(args.updateParams, (uint256, int224, uint32));

        // Derive data feed ID
        bytes32 dataFeedId = keccak256(
            abi.encode(args.airnodes, args.templateIds)
        );

        IDapiDataRegistry(dapiDataRegistry).addDapi(
            args.dapiName,
            dataFeedId,
            args.sponsorWallet,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval,
            args.dapiRoot,
            args.dapiProof
        );

        // Fund the dAPI sponsor wallet to top it up to price (price from merkle tree)
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(
                DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE
            ) == args.priceRoot,
            "Root has not been registered"
        );
        bytes32 priceLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        args.dapiName,
                        block.chainid,
                        args.updateParams,
                        args.duration,
                        args.price
                    )
                )
            )
        );
        require(
            MerkleProof.verify(args.priceProof, args.priceRoot, priceLeaf),
            "Invalid proof"
        );
        require(msg.value >= args.price, "Insufficient payment");

        // Deploy the dAPI proxy (if it hasn't been deployed yet)
        // TODO: check if proxy has been deployed (see: https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/proxies/ProxyFactory.sol#L140)
        address proxyAddress = IProxyFactory(proxyFactory).deployDapiProxy(
            args.dapiName,
            ""
        );

        // Update the dAPI with signed API data (if it hasn't been updated recently, what's recently?)
        // TODO: why signed data? shouldn't we instead just call updateBeaconSetWithBeacons()?
        bytes32[] memory beaconIds = new bytes32[](args.airnodes.length);
        for (uint ind = 0; ind < args.airnodes.length; ind++) {
            beaconIds[ind] = keccak256(
                abi.encodePacked(args.airnodes[ind], args.templateIds[ind])
            );
        }
        IApi3ServerV1(api3ServerV1).updateBeaconSetWithBeacons(beaconIds);

        // TODO: Should we only sent the delta between price and sponsor wallet balance? If so, what to do with the rest?
        // TODO: Will this contract require a withdraw() function?
        Address.sendValue(args.sponsorWallet, msg.value);

        // TODO: emit event (include proxyAddress and updated sponsor wallet balance)
    }
}
