// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaOperator} from "./GammaOperator.sol";
import {IGammaRedeemerV1} from "./IGammaRedeemerV1.sol";

contract GammaRedeemerV1 is IGammaRedeemerV1, GammaOperator {
    Order[] public orders;

    modifier onlyAuthorized() {
        // msg.sender == executor
        _;
    }

    constructor(address _gamma) GammaOperator(_gamma) {}

    function createOrder(
        address _otoken,
        uint256 _amount,
        uint256 _vaultId
    ) public {
        require(
            isWhitelistedOtoken(_otoken),
            "GammaRedeemer::createOrder: Otoken not whitelisted"
        );

        uint256 orderId = orders.length;

        Order memory order;
        order.owner = msg.sender;
        order.otoken = _otoken;
        order.amount = _amount;
        order.vaultId = _vaultId;
        order.isSeller = _amount == 0;
        orders.push(order);

        // create auto task

        emit OrderCreated(orderId, msg.sender, _otoken);
    }

    function cancelOrder(uint256 _orderId) public {
        require(
            orders[_orderId].owner == msg.sender,
            "GammaRedeemer::cancelOrder: Sender is not order owner"
        );
        require(
            !orders[_orderId].finished,
            "GammaRedeemer::cancelOrder: Order is already finished"
        );

        orders[_orderId].finished = true;

        // cancel auto task

        emit OrderFinished(_orderId, true);
    }

    function shouldProcessOrder(uint256 _orderId) public view returns (bool) {
        Order memory order = orders[_orderId];

        if (order.isSeller) {
            bool shouldSettle = shouldSettleVault(order.owner, order.vaultId);
            if (!shouldSettle) return false;
        } else {
            bool shouldRedeem = shouldRedeemOtoken(
                order.owner,
                order.otoken,
                order.amount
            );
            if (!shouldRedeem) return false;
        }

        return true;
    }

    function processOrder(uint256 _orderId) public onlyAuthorized {
        Order storage order = orders[_orderId];
        require(
            !order.finished,
            "GammaRedeemer::processOrder: Order is already finished"
        );

        require(
            shouldProcessOrder(_orderId),
            "GammaRedeemer::processOrder: Order should not be processed"
        );
        order.finished = true;

        // process
        if (order.isSeller) {
            settleVault(order.owner, order.vaultId);
        } else {
            redeemOtoken(order.owner, order.otoken, order.amount);
        }

        emit OrderFinished(_orderId, false);
    }
}
