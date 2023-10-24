// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "./IHashRegistry.sol";

interface IDapiFallbackV2 {
    struct ExecuteDapiFallbackArgs {
        bytes32 dapiName;
        bytes32 beaconId;
        bytes32 fallbackRoot;
        bytes32[] fallbackProof;
        bytes32 updateParams;
        bytes32 priceRoot;
        bytes32[] priceProof;
        uint256 duration;
        uint256 price;
        address payable sponsorWallet;
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
        bytes32 indexed beaconId,
        address sender
    );

    function api3ServerV1() external view returns (IApi3ServerV1);

    function hashRegistry() external view returns (IHashRegistry);

    function DAPI_FALLBACK_HASH_TYPE() external view returns (bytes32);

    function PRICE_HASH_TYPE() external view returns (bytes32);

    function withdraw(address payable recipient, uint256 amount) external;

    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external;
}
