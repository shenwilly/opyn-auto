// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaOperator} from "./GammaOperator.sol";
import {IGammaRedeemerV1} from "./interfaces/IGammaRedeemerV1.sol";
import {IPokeMe} from "./interfaces/IPokeMe.sol";

/// @author Willy Shen
/// @title Gamma Automatic Redeemer
/// @notice An automatic redeemer for Gmma otoken holders and writers
contract GammaRedeemerV1 is IGammaRedeemerV1, GammaOperator {
    Order[] public orders;

    IPokeMe public automator;

    /**
     * @notice only automator
     */
    modifier onlyAuthorized() {
        // msg.sender == executor
        _;
    }

    constructor(address _gammaAddressBook, address _automator)
        GammaOperator(_gammaAddressBook)
    {
        automator = IPokeMe(_automator);
    }

    /**
     * @notice create automation order
     * @param _otoken the address of otoken
     * @param _amount amount of otoken
     * @param _vaultId only for writers, the vaultId to settle
     */
    function createOrder(
        address _otoken,
        uint256 _amount,
        uint256 _vaultId
    ) public override {
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

        automator.createTask(
            address(this),
            abi.encodeWithSelector(
                bytes4(keccak256("processOrder(uint256)")),
                orderId
            )
        );

        emit OrderCreated(orderId, msg.sender, _otoken);
    }

    /**
     * @notice cancel automation order
     * @param _orderId the order Id to be cancelled
     */
    function cancelOrder(uint256 _orderId) public override {
        require(
            orders[_orderId].owner == msg.sender,
            "GammaRedeemer::cancelOrder: Sender is not order owner"
        );
        require(
            !orders[_orderId].finished,
            "GammaRedeemer::cancelOrder: Order is already finished"
        );

        orders[_orderId].finished = true;

        automator.cancelTask(
            address(this),
            abi.encodeWithSelector(
                bytes4(keccak256("processOrder(uint256)")),
                _orderId
            )
        );

        emit OrderFinished(_orderId, true);
    }

    /**
     * @notice check if processing order is allowed and profitable
     * @dev automator should call this first before calling processOrder
     * @param _orderId the order Id to be processed
     * @return true if vault can be settled (writer) / otoken can be redeemed (buyer)
     */
    function shouldProcessOrder(uint256 _orderId)
        public
        view
        override
        returns (bool)
    {
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

    /**
     * @notice process an order
     * @dev only automator allowed
     * @param _orderId the order Id to be processed
     */
    function processOrder(uint256 _orderId) public override onlyAuthorized {
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

    function withdrawFund(uint256 _amount) public {
        automator.withdrawFunds(_amount);
        (bool success, ) = owner().call{value: _amount}("");
        require(success, "GammaRedeemer::withdrawFunds: Withdraw funds failed");
    }

    function getOrdersLength() public view returns (uint256) {
        return orders.length;
    }

    receive() external payable {}
}
