// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Address.sol";
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

    function withdraw(uint256 amount) external override onlyOwner {
        require(amount != 0, "Amount zero");
        require(
            address(this).balance >= amount,
            "Insufficient contract balance"
        );
        Address.sendValue(payable(msg.sender), amount);
        emit Withdrawn(msg.sender, amount, address(this).balance);
    }

    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external override {
        bytes32 currentDataFeedId = IApi3ServerV1(api3ServerV1)
            .dapiNameHashToDataFeedId(args.dapiName);
        require(
            currentDataFeedId != args.dataFeedId,
            "Data feed ID will not be changed"
        );

        bytes32 fallbackLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        args.dapiName,
                        args.dataFeedId,
                        args.sponsorWallet
                    )
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
            uint256 amount = minSponsorWalletBalance - sponsorWalletBalance;
            require(
                address(this).balance >= amount,
                "Insufficient contract balance"
            );
            Address.sendValue(args.sponsorWallet, amount);
            emit FundedSponsorWallet(
                args.sponsorWallet,
                amount,
                address(this).balance,
                msg.sender
            );
        }
        IApi3ServerV1(api3ServerV1).setDapiName(args.dapiName, args.dataFeedId);
        emit ExecutedDapiFallback(args.dapiName, args.dataFeedId, msg.sender);
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
}
