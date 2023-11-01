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
        require(args.beacons.length != 0, "Beacons is empty");

        // Store Signed API URLs for all the Airnodes used by the constituent beacons of the beaconSet
        require(
            args.beacons.length == args.signedApiUrlProofs.length,
            "Signed API URL proofs length is incorrect"
        );
        for (uint ind = 0; ind < args.signedApiUrlProofs.length; ind++) {
            // TODO: This is very naive and does not check if url being registered is the same for the current airnode
            //       Should we add that check to avoid re-setting the same value to state if values are equal?
            IDapiDataRegistry(dapiDataRegistry).registerAirnodeSignedApiUrl(
                args.beacons[ind].airnode,
                args.beacons[ind].url,
                args.signedApiUrlRoot,
                args.signedApiUrlProofs[ind]
            );
        }

        // Store the actual data used to derive each beaconId (if more than one then it will also be used to derive the beaconSetId)
        bytes32 dataFeedId;
        if (args.beacons.length == 1) {
            dataFeedId = IDapiDataRegistry(dapiDataRegistry).registerDataFeed(
                abi.encode(args.beacons[0].airnode, args.beacons[0].templateId)
            );
        } else {
            address[] memory airnodes = new address[](args.beacons.length);
            bytes32[] memory templateIds = new bytes32[](args.beacons.length);
            for (uint ind = 0; ind < args.beacons.length; ind++) {
                airnodes[ind] = args.beacons[ind].airnode;
                templateIds[ind] = args.beacons[ind].templateId;
            }
            dataFeedId = IDapiDataRegistry(dapiDataRegistry).registerDataFeed(
                abi.encode(airnodes, templateIds)
            );
        }

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
        ) = abi.decode(args.dapi.updateParams, (uint256, int224, uint32));

        IDapiDataRegistry(dapiDataRegistry).addDapi(
            args.dapi.name,
            dataFeedId,
            args.dapi.sponsorWallet,
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
        require(
            MerkleProof.verify(
                args.priceProof,
                args.priceRoot,
                keccak256(
                    bytes.concat(
                        keccak256(
                            abi.encode(
                                args.dapi.name,
                                block.chainid,
                                args.dapi.updateParams,
                                args.dapi.duration,
                                args.dapi.price
                            )
                        )
                    )
                )
            ),
            "Invalid proof"
        );
        require(msg.value >= args.dapi.price, "Insufficient payment");

        // Deploy the dAPI proxy (if it hasn't been deployed yet)
        address dapiProxyAddress = IProxyFactory(proxyFactory)
            .computeDapiProxyAddress(args.dapi.name, "");
        // https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/utils/ExtendedSelfMulticall.sol#L36
        if (dapiProxyAddress.code.length == 0) {
            IProxyFactory(proxyFactory).deployDapiProxy(args.dapi.name, "");
        }

        // Update the dAPI with signed API data (if it hasn't been updated recently)
        (, uint32 timestamp) = IApi3ServerV1(api3ServerV1).dataFeeds(
            dataFeedId
        );
        if (timestamp + heartbeatInterval <= block.timestamp) {
            bytes32[] memory beaconIds = new bytes32[](args.beacons.length);
            for (uint ind = 0; ind < args.beacons.length; ind++) {
                beaconIds[ind] = IApi3ServerV1(api3ServerV1)
                    .updateBeaconWithSignedData(
                        args.beacons[ind].airnode,
                        args.beacons[ind].templateId,
                        args.beacons[ind].timestamp, // Signature timestamp
                        args.beacons[ind].data, // Update data (an `int256` encoded in contract ABI)
                        args.beacons[ind].signature // Template ID, timestamp and the update data signed by the Airnode
                    );
            }
            IApi3ServerV1(api3ServerV1).updateBeaconSetWithBeacons(beaconIds);
        }

        // Fund sponsor wallet with order payment price
        Address.sendValue(args.dapi.sponsorWallet, msg.value);

        emit BoughtDapi(
            args.dapi.name,
            dataFeedId,
            dapiProxyAddress,
            args.dapi.price,
            args.dapi.duration,
            args.dapi.updateParams,
            args.dapi.sponsorWallet.balance,
            msg.sender
        );
    }
}
