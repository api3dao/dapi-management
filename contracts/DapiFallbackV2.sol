// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";

contract DapiFallbackV2 is Ownable, IDapiFallbackV2 {
    address public immutable api3ServerV1;
    address public immutable hashRegistry;

    bytes32 private constant _DAPI_FALLBACK_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI fallback Merkle tree root"));
    bytes32 private constant _PRICE_HASH_TYPE =
        keccak256(abi.encodePacked("Price Merkle tree root"));

    constructor(address _api3ServerV1, address _hashRegistry) {
        require(
            _api3ServerV1 != address(0) && _hashRegistry != address(0),
            "Address cannot be zero"
        );
        api3ServerV1 = _api3ServerV1;
        hashRegistry = _hashRegistry;
    }

    receive() external payable {}

    function withdraw(
        uint256 amount
    ) external override onlyOwner {
        _withdraw(payable(msg.sender), amount);
    }

    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external override {
        bytes32 currentBeaconId = IApi3ServerV1(api3ServerV1)
            .dapiNameHashToDataFeedId(args.dapiName);
        require(
            currentBeaconId != args.beaconId,
            "Beacon ID will not be changed"
        );

        bytes32 fallbackLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(args.dapiName, args.beaconId, args.sponsorWallet)
                )
            )
        );
        _validateTree(
            _DAPI_FALLBACK_HASH_TYPE,
            args.fallbackProof,
            args.fallbackRoot,
            fallbackLeaf
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

        _validateTree(
            _PRICE_HASH_TYPE,
            args.priceProof,
            args.priceRoot,
            priceLeaf
        );

        uint256 minSponsorWalletBalance = (args.price * 86400) / args.duration;

        uint256 sponsorWalletBalance = args.sponsorWallet.balance;
        if (sponsorWalletBalance < minSponsorWalletBalance) {
            _fundSponsorWallet(
                args.sponsorWallet,
                minSponsorWalletBalance - sponsorWalletBalance
            );
        }
        IApi3ServerV1(api3ServerV1).setDapiName(args.dapiName, args.beaconId);
        emit ExecutedDapiFallback(args.dapiName, args.beaconId, msg.sender);
    }

    function _validateTree(
        bytes32 treeType,
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) private view {
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(treeType) == root,
            "Tree has not been registered"
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid tree proof");
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
