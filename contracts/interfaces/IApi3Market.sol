// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IApi3Market {
    // TODO: This struct is used to avoid the infamous stack too deep error
    struct BuyDapiArgs {
        address[] airnodes;
        string[] urls;
        bytes32 signedApiUrlRoot;
        bytes32[][] signedApiUrlProofs;
        bytes32[] templateIds;
        bytes32 dapiName;
        bytes updateParams;
        address payable sponsorWallet;
        bytes32 dapiRoot;
        bytes32[] dapiProof;
        uint256 price;
        uint256 duration;
        bytes32 priceRoot;
        bytes32[] priceProof;
    }

    function hashRegistry() external view returns (address);

    function dapiDataRegistry() external view returns (address);

    function proxyFactory() external view returns (address);

    function api3ServerV1() external view returns (address);

    function buyDapi(BuyDapiArgs calldata args) external payable;
}
