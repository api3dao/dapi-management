// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IDapiFallbackV2 {
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
        bytes32 dataFeedId,
        address sender
    );

    function withdraw(address payable recipient, uint256 amount) external;

    function executeDapiFallback(
        bytes32 dapiName,
        bytes32 beaconId,
        address payable sponsorWallet,
        bytes32 fallbackRoot,
        bytes32[] calldata fallbackProof,
        bytes32 updateParams,
        uint256 duration,
        uint256 price,
        bytes32 priceRoot,
        bytes32[] calldata priceProof
    ) external;
}
