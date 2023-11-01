// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IApi3Market {
    event BoughtDapi(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address dapiProxyAddress,
        uint256 price,
        uint256 duration,
        bytes updateParams,
        uint256 sponsorWalletBalance,
        address sender
    );

    struct Beacon {
        address airnode;
        bytes32 templateId;
        uint256 timestamp;
        bytes data;
        bytes signature;
        string url;
    }

    struct Dapi {
        bytes32 name;
        address payable sponsorWallet;
        bytes updateParams;
        uint256 price;
        uint256 duration;
    }

    struct BuyDapiArgs {
        Dapi dapi;
        Beacon[] beacons;
        bytes32 signedApiUrlRoot;
        bytes32[][] signedApiUrlProofs;
        bytes32 dapiRoot;
        bytes32[] dapiProof;
        bytes32 priceRoot;
        bytes32[] priceProof;
    }

    function hashRegistry() external view returns (address);

    function dapiDataRegistry() external view returns (address);

    function proxyFactory() external view returns (address);

    function api3ServerV1() external view returns (address);

    function buyDapi(BuyDapiArgs calldata args) external payable;
}
