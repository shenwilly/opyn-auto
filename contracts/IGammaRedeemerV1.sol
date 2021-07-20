// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

interface IGammaRedeemerV1 {
    struct Order {
        address owner;
        address otoken;
        uint256 amount;
        uint256 vaultId;
        bool isSeller;
        bool toETH;
        bool finished;
    }

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address indexed otoken
    );
    event OrderFinished(uint256 indexed orderId, bool indexed cancelled);
}
