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

    function createOrder(
        address _otoken,
        uint256 _amount,
        uint256 _vaultId
    ) external;

    function cancelOrder(uint256 _orderId) external;

    function shouldProcessOrder(uint256 _orderId) external view returns (bool);

    function processOrder(uint256 _orderId) external;
}
