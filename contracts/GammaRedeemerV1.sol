// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaOperator} from "./GammaOperator.sol";
import {IGammaRedeemerV1} from "./interfaces/IGammaRedeemerV1.sol";
import {IUniswapRouter} from "./interfaces/IUniswapRouter.sol";
import {IPokeMe} from "./interfaces/IPokeMe.sol";
import {ITaskTreasury} from "./interfaces/ITaskTreasury.sol";
import {IResolver} from "./interfaces/IResolver.sol";

/// @author Willy Shen
/// @title Gamma Automatic Redeemer
/// @notice An automatic redeemer for Gamma otoken holders and writers
contract GammaRedeemerV1 is IGammaRedeemerV1, GammaOperator {
    Order[] public orders;

    IUniswapRouter public uniRouter;
    IPokeMe public automator;
    ITaskTreasury public automatorTreasury;
    bool public isAutomatorEnabled;

    mapping(address => mapping(address => bool)) public uniPair;

    // fee in 1/10.000: 1% = 100, 0.01% = 1
    uint256 public redeemFee = 50;
    uint256 public settleFee = 10;

    /**
     * @notice only automator or owner
     */
    modifier onlyAuthorized() {
        require(
            msg.sender == address(automator) || msg.sender == owner(),
            "GammaRedeemer::onlyAuthorized: Only automator or owner"
        );
        _;
    }

    constructor(
        address _gammaAddressBook,
        address _uniRouter,
        address _automator,
        address _automatorTreasury
    ) GammaOperator(_gammaAddressBook) {
        uniRouter = IUniswapRouter(_uniRouter);
        automator = IPokeMe(_automator);
        automatorTreasury = ITaskTreasury(_automatorTreasury);
        isAutomatorEnabled = false;
    }

    function startAutomator(address _resolver) public onlyOwner {
        require(!isAutomatorEnabled);
        isAutomatorEnabled = true;
        automator.createTask(
            address(this),
            bytes4(keccak256("processOrders(uint256[])")),
            _resolver,
            abi.encodeWithSelector(IResolver.getProcessableOrders.selector)
        );
    }

    function stopAutomator() public onlyOwner {
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
     * @param _otoken the address of otoken (only holders)
     * @param _amount amount of otoken (only holders)
     * @param _vaultId the id of specific vault to settle (only writers)
     */
    function createOrder(
        address _otoken,
        uint256 _amount,
        uint256 _vaultId,
        address _toToken
    ) public override {
        uint256 fee;
        bool isSeller;
        if (_otoken == address(0)) {
            require(
                _amount == 0,
                "GammaRedeemer::createOrder: Amount must be 0 when creating settlement order"
            );
            fee = settleFee;
            isSeller = true;
        } else {
            require(
                isWhitelistedOtoken(_otoken),
                "GammaRedeemer::createOrder: Otoken not whitelisted"
            );
            fee = redeemFee;
        }

        if (_toToken != address(0)) {
            address payoutToken;
            if (isSeller) {
                address otoken = getVaultOtoken(msg.sender, _vaultId);
                payoutToken = getOtokenCollateral(otoken);
            } else {
                payoutToken = getOtokenCollateral(_otoken);
            }
            require(uniPair[payoutToken][_toToken], "GammaRedeemer::createOrder: settlement token not allowed");
        }

        uint256 orderId = orders.length;

        Order memory order;
        order.owner = msg.sender;
        order.otoken = _otoken;
        order.amount = _amount;
        order.vaultId = _vaultId;
        order.isSeller = isSeller;
        order.fee = fee;
        order.toToken = _toToken;
        orders.push(order);

        emit OrderCreated(orderId, msg.sender, _otoken);
    }

    /**
     * @notice cancel automation order
     * @param _orderId the id of specific order to be cancelled
     */
    function cancelOrder(uint256 _orderId) public override {
        Order storage order = orders[_orderId];
        require(
            order.owner == msg.sender,
            "GammaRedeemer::cancelOrder: Sender is not order owner"
        );
        require(
            !order.finished,
            "GammaRedeemer::cancelOrder: Order is already finished"
        );

        order.finished = true;
        emit OrderFinished(_orderId, true);
    }

    /**
     * @notice check if processing order is profitable
     * @param _orderId the id of specific order to be processed
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

    /**
     * @notice process an order
     * @dev only automator allowed
     * @param _orderId the id of specific order to process
     */
    function processOrder(uint256 _orderId, ProcessOrderArgs calldata orderArgs)
        public
        override
        onlyAuthorized
    {
        Order storage order = orders[_orderId];
        require(
            shouldProcessOrder(_orderId),
            "GammaRedeemer::processOrder: Order should not be processed"
        );
        order.finished = true;

        if (order.isSeller) {
            settleVault(order.owner, order.vaultId, order.fee);
        } else {
            redeemOtoken(order.owner, order.otoken, order.amount, order.fee);
        }

        // if (order.toToken != address(0)) {
        // swap(amountIn, orderArgs.swapAmountOutMin, orderArgs.swapPath)
        // safeTransferFrom(orderArgs.to)
        // }

        emit OrderFinished(_orderId, false);
    }

    /**
     * @notice process multiple orders
     * @param _orderIds array of order ids to process
     */
    function processOrders(
        uint256[] calldata _orderIds,
        ProcessOrderArgs[] calldata _orderArgs
    ) public override {
        require(
            _orderIds.length == _orderArgs.length,
            "GammaRedeemer::processOrders: Params lengths must be same"
        );
        for (uint256 i = 0; i < _orderIds.length; i++) {
            processOrder(_orderIds[i], _orderArgs[i]);
        }
    }

    function swap(
        uint256 _amountIn,
        uint256 _amountOutMin,
        address[] calldata path
    ) internal returns (uint256[] memory amounts) {
        return
            IUniswapRouter(uniRouter).swapExactTokensForTokens(
                _amountIn,
                _amountOutMin,
                path,
                address(this),
                block.timestamp
            );
    }

    /**
     * @notice withdraw funds from automator
     * @param _token address of token to withdraw
     * @param _amount amount of token to withdraw
     */
    function withdrawFund(address _token, uint256 _amount) public onlyOwner {
        automatorTreasury.withdrawFunds(payable(this), _token, _amount);
    }

    function setUniRouter(address _uniRouter) public onlyOwner {
        uniRouter = IUniswapRouter(_uniRouter);
    }

    function setAutomator(address _automator) public onlyOwner {
        automator = IPokeMe(_automator);
    }

    function setAutomatorTreasury(address _automatorTreasury) public onlyOwner {
        automatorTreasury = ITaskTreasury(_automatorTreasury);
    }

    function setRedeemFee(uint256 _redeemFee) public onlyOwner {
        redeemFee = _redeemFee;
    }

    function setSettleFee(uint256 _settleFee) public onlyOwner {
        settleFee = _settleFee;
    }

    function allowPair(address _token0, address _token1) public onlyOwner {
        require(
            !uniPair[_token0][_token1],
            "GammaRedeemer::allowPair: already allowed"
        );
        uniPair[_token0][_token1] = true;
        uniPair[_token1][_token0] = true;
    }

    function disallowPair(address _token0, address _token1) public onlyOwner {
        require(
            uniPair[_token0][_token1],
            "GammaRedeemer::allowPair: already disallowed"
        );
        uniPair[_token0][_token1] = false;
        uniPair[_token1][_token0] = false;
    }

    function getOrdersLength() public view override returns (uint256) {
        return orders.length;
    }

    function getOrders() public view override returns (Order[] memory) {
        return orders;
    }

    function getOrder(uint256 _orderId)
        public
        view
        override
        returns (Order memory)
    {
        return orders[_orderId];
    }
}
