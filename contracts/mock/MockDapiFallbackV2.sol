// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

contract MockDapiFallbackV2 {
    function getRevertableDapiFallbacks()
        external
        pure
        returns (bytes32[] memory dapis)
    {
        dapis = new bytes32[](5);
        dapis[0] = bytes32(
            0x415049332f555344000000000000000000000000000000000000000000000000
        );
        dapis[1] = bytes32(
            0x4254432f55534400000000000000000000000000000000000000000000000000
        );
        dapis[2] = bytes32(
            0x4554482f55534400000000000000000000000000000000000000000000000000
        );
        dapis[3] = bytes32(
            0x4d415449432f5553440000000000000000000000000000000000000000000000
        );
        dapis[4] = bytes32(
            0x554e492f55534400000000000000000000000000000000000000000000000000
        );
    }
}
