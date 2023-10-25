// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";

contract DapiFallbackV2 is Ownable, IDapiFallbackV2 {
    IApi3ServerV1 public immutable override api3ServerV1;
    IHashRegistry public immutable override hashRegistry;

    // keccak256(abi.encodePacked("dAPI fallback merkle tree root"));
    bytes32 public constant override DAPI_FALLBACK_HASH_TYPE =
        0x9abf68c65165db40997b7281172ee53d4fdf09977459c7d590cd8f7df6d8f966;
    // keccak256(abi.encodePacked("Price merkle tree root"));
    bytes32 public constant override PRICE_HASH_TYPE =
        0x749ebf36df1b524d3282fd33252feb0a23f304bb2aab84d0a58bf1341953b233;

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
        ExecuteDapiFallbackArgs calldata args
    ) external override {
        bytes32 currentBeaconId = api3ServerV1.dapiNameHashToDataFeedId(
            args.dapiName
        );
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
            DAPI_FALLBACK_HASH_TYPE,
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
            PRICE_HASH_TYPE,
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
        api3ServerV1.setDapiName(args.dapiName, args.beaconId);
        emit ExecutedDapiFallback(args.dapiName, args.beaconId, msg.sender);
    }

    function _validateTree(
        bytes32 treeType,
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) private view {
        require(root != bytes32(0), "Root is zero");
        require(proof.length != 0, "Proof is empty");
        require(
            hashRegistry.hashTypeToHash(treeType) == root,
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
