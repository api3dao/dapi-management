// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IDapiFallbackV2 {
    struct ExecuteDapiFallbackArgs {
        bytes32 dapiName;
        bytes32 beaconId;
        address payable sponsorWallet;
        bytes32 fallbackRoot;
        bytes32[] fallbackProof;
        bytes32 updateParams;
        uint256 duration;
        uint256 price;
        bytes32 priceRoot;
        bytes32[] priceProof;
    }

    event Withdrawn(
        address indexed recipient,
        uint256 amount,
        uint256 remainingBalance
    );

    event FundedSponsorWallet(
        address indexed sponsorWallet,
        uint256 amount,
        uint256 remainingBalance,
        address sender
    );

    event ExecutedDapiFallback(
        bytes32 indexed dapiName,
        bytes32 beaconId, // Changed from 'dataFeedId' to 'beaconId' for consistency
        address sender
    );

    function withdraw(address payable recipient, uint256 amount) external;

    function executeDapiFallback(ExecuteDapiFallbackArgs calldata args) external;
}
