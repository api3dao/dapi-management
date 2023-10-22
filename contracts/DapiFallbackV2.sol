// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";

contract DapiFallbackV2 is Ownable, SelfMulticall, IDapiFallbackV2 {
    IApi3ServerV1 public immutable api3ServerV1;
    IHashRegistry public immutable hashRegistry;

    // keccak256(abi.encodePacked("dAPI Fallback MT"));
    bytes32 private constant _DAPI_FALLBACK_HASH_TYPE =
        0xa1f152b75fab21ed39ef9fa127cf2464bd0724362a2216706751dc25c1aa7b32;
    // keccak256(abi.encodePacked("Price MT"));
    bytes32 private constant _PRICE_HASH_TYPE =
        0x9122813f1a7419dafd01165e545b04d2a3104a5e0076fe088ecd4f999697ecf8;

    constructor(IApi3ServerV1 _api3ServerV1, IHashRegistry _hashRegistry) {
        api3ServerV1 = _api3ServerV1;
        hashRegistry = _hashRegistry;
    }

    receive() external payable {}

    function withdraw(
        address payable recipient,
        uint256 amount
    ) external override onlyOwner {
        _withdraw(recipient, amount);
    }

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
    ) external override {
        bytes32 currentBeaconId = api3ServerV1.dapiNameHashToDataFeedId(
            dapiName
        );
        require(currentBeaconId != beaconId, "Beacon ID will not change");
        require(fallbackRoot != bytes32(0), "Fallback root is zero");
        require(priceRoot != bytes32(0), "Price root is zero");
        require(fallbackProof.length != 0, "Fallback proof is empty");
        require(priceProof.length != 0, "Price proof is empty");
        require(
            hashRegistry.hashTypeToHash(_DAPI_FALLBACK_HASH_TYPE) ==
                fallbackRoot,
            "Fallback root has not been registered"
        );
        require(
            hashRegistry.hashTypeToHash(_PRICE_HASH_TYPE) == priceRoot,
            "Price root has not been registered"
        );

        bytes32 fallbackLeaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, beaconId, sponsorWallet))
            )
        );
        require(
            MerkleProof.verify(fallbackProof, fallbackRoot, fallbackLeaf),
            "Invalid fallback proof"
        );

        bytes32 priceLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        dapiName,
                        block.chainid,
                        updateParams,
                        duration,
                        price
                    )
                )
            )
        );
        require(
            MerkleProof.verify(priceProof, priceRoot, priceLeaf),
            "Invalid price proof"
        );

        uint256 minSponsorWalletBalance = (price * 86400) / duration;

        uint256 sponsorWalletBalance = sponsorWallet.balance;
        if (sponsorWalletBalance < minSponsorWalletBalance) {
            _fundSponsorWallet(
                sponsorWallet,
                minSponsorWalletBalance - sponsorWalletBalance
            );
        }
        api3ServerV1.setDapiName(dapiName, beaconId);
        emit ExecutedDapiFallback(dapiName, beaconId, msg.sender);
    }

    function _withdraw(address payable recipient, uint256 amount) private {
        require(recipient != address(0), "Recipient address zero");
        require(amount != 0, "Amount zero");
        require(
            address(this).balance >= amount,
            "Insufficient contract balance"
        );
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Failed to withdraw");
        emit Withdrawn(recipient, amount, address(this).balance);
    }

    function _fundSponsorWallet(
        address payable sponsorWallet,
        uint256 amount
    ) private {
        require(
            address(this).balance >= amount,
            "Insufficient contract balance"
        );
        (bool success, ) = sponsorWallet.call{value: amount}("");
        require(success, "Failed to fund sponsor wallet");
        emit FundedSponsorWallet(
            sponsorWallet,
            amount,
            address(this).balance,
            msg.sender
        );
    }
}
