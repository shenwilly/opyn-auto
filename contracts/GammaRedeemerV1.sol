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
    mapping(bytes32 => bool) checks;

    IPokeMe public automator;
    bool public isAutomatorEnabled;

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
        isAutomatorEnabled = false;
    }

    function startAutomator() public onlyOwner {
        require(!isAutomatorEnabled);
        isAutomatorEnabled = true;
        automator.createTask(
            address(this), 
            bytes4(keccak256("processOrders(uint256[])")),
            address(this), 
            abi.encodeWithSelector(bytes4(keccak256("getProcessableOrders()")))
        );
    }

    function pauseAutomator() public onlyOwner {
        require(isAutomatorEnabled);
        isAutomatorEnabled = false;
        automator.cancelTask(
            automator.getTaskId(
                address(this), 
                address(this), 
                bytes4(keccak256("processOrders(uint256[])"))
            )
        );
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
        bytes32 orderhash;
        if (_otoken == address(0)) {
            require(_amount == 0, "GammaRedeemer::createOrder: Amount must be 0 when creating settle order");
            orderhash = keccak256(abi.encode(msg.sender, _otoken));
        } else {
            require(
                isWhitelistedOtoken(_otoken),
                "GammaRedeemer::createOrder: Otoken not whitelisted"
            );
            orderhash = keccak256(abi.encode(msg.sender, _vaultId));
        }

        require(!checks[orderhash], "GammaRedeemer::createOrder: Order has been created before");

        uint256 orderId = orders.length;

        Order memory order;
        order.owner = msg.sender;
        order.otoken = _otoken;
        order.amount = _amount;
        order.vaultId = _vaultId;
        order.isSeller = _amount == 0;
        orders.push(order);

        checks[orderhash] = true;
        
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

        emit OrderFinished(_orderId, true);
    }

    /**
     * @notice check if processing order is profitable
     * @dev automator should call this first before calling processOrder
     * @param _orderId the id of the order to be processed
     * @return true if settling vault / redeeming returns more than 0 amount
     */
    function shouldProcessOrder(uint256 _orderId)
        public
        view
        override
        returns (bool)
    {
        Order memory order = orders[_orderId];
        if (order.finished) return false;

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

    function getProcessableOrders() public view returns (uint256[] memory) {
        uint256 executableOrderTotal;
        for (uint256 i = 0; i < orders.length; i++) {
            if (shouldProcessOrder(i)) {
                executableOrderTotal++;
            }
        }

        uint256 counter;
        uint256[] memory orderIds = new uint256[](executableOrderTotal);
        for (uint256 i = 0; i < orders.length; i++) {
            if (shouldProcessOrder(i)) {
                orderIds[counter] = i;
                counter++;
            }
        }
        return orderIds;
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

    function processOrders(uint256[] calldata _orderIds) public onlyAuthorized {
        for (uint256 i = 0; i < _orderIds.length; i++) {
            processOrder(_orderIds[i]);
        }
    }

    function withdrawFund(uint256 _amount) public {
        // automator.withdrawFunds(_amount);
        // (bool success, ) = owner().call{value: _amount}("");
        // require(success, "GammaRedeemer::withdrawFunds: Withdraw funds failed");
    }

    function getOrdersLength() public view returns (uint256) {
        return orders.length;
    }

    receive() external payable {}
}
