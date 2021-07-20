// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import {IGammaController} from "./interfaces/IGammaController.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IAddressBook} from "./interfaces/IAddressBook.sol";
import {IMarginCalculator} from "./interfaces/IMarginCalculator.sol";
import {IOtoken} from "./interfaces/IOtoken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Actions} from "./external/OpynActions.sol";
import {MarginVault} from "./external/OpynVault.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GammaRedeemer is Ownable {
    using SafeERC20 for IERC20;

    struct Order {
        address owner;
        address otoken;
        uint256 amount;
        uint256 vaultId;
        bool isSeller;
        bool toETH;
        bool finished;
    }

    IGammaController public gammaController;
    IWhitelist public whitelist;
    IAddressBook public addressBook;
    IMarginCalculator public calculator;
    Order[] public orders;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address indexed otoken
    );
    event OrderFinished(uint256 indexed orderId, bool indexed cancelled);

    modifier onlyAuthorized() {
        // msg.sender == executor
        _;
    }

    constructor(address _addressBook) {
        setAddressBook(_addressBook);
        refreshConfig();
    }

    function createOrder(
        address _otoken,
        uint256 _amount,
        uint256 _vaultId
    ) public {
        require(
            whitelist.isWhitelistedOtoken(_otoken),
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

    function canProcessOrder(uint256 _orderId) public view returns (bool) {
        Order memory order = orders[_orderId];
        address otoken = order.otoken;
        address owner = order.owner;

        bool hasExpired = block.timestamp >= IOtoken(otoken).expiryTimestamp();
        if (!hasExpired) return false;

        bool isAllowed = canSettle(otoken);
        if (!isAllowed) return false;

        if (order.isSeller) {
            bool isOperator = gammaController.isOperator(owner, address(this));
            if (!isOperator) return false;

            (
                MarginVault.Vault memory vault,
                uint256 typeVault,

            ) = gammaController.getVaultWithDetails(owner, order.vaultId);

            (uint256 payout, bool isValidVault) = calculator
                .getExcessCollateral(vault, typeVault);
            if (!isValidVault || payout == 0) return false;
        } else {
            uint256 ownerBalance = IERC20(otoken).balanceOf(owner);
            uint256 allowance = IERC20(otoken).allowance(owner, address(this));
            uint256 spendable = min(ownerBalance, allowance);
            uint256 actualAmount = min(order.amount, spendable);
            uint256 payout = gammaController.getPayout(otoken, actualAmount);
            if (payout == 0) return false; // no need to process order if not profitable
        }

        return true;
    }

    function processOrder(uint256 _orderId) public onlyAuthorized {
        Order storage order = orders[_orderId];
        require(
            !order.finished,
            "GammaRedeemer::redeem: Order is already finished"
        );

        require(
            canProcessOrder(_orderId),
            "GammaRedeemer::redeem: Order cannot be processed yet"
        );

        address owner = order.owner;
        address otoken = order.otoken;
        uint256 amount = order.amount;

        order.finished = true;

        uint256 ownerBalance = IERC20(otoken).balanceOf(order.owner);
        uint256 actualAmount = min(amount, ownerBalance);
        require(actualAmount > 0, "GammaRedeemer::redeem: No Otoken found");

        IERC20(otoken).safeTransferFrom(owner, address(this), actualAmount);

        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.Redeem;
        action.secondAddress = owner;
        action.asset = otoken;
        action.amount = actualAmount;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        gammaController.operate(actions);

        emit OrderFinished(_orderId, false);
    }

    function canSettle(address _otoken) public view returns (bool) {
        return gammaController.isSettlementAllowed(_otoken);
    }

    function setAddressBook(address _address) public onlyOwner {
        require(_address != address(0));
        addressBook = IAddressBook(_address);
    }

    function refreshConfig() public {
        address _gammaController = addressBook.getController();
        gammaController = IGammaController(_gammaController);

        address _whitelist = addressBook.getWhitelist();
        whitelist = IWhitelist(_whitelist);

        address _calculator = addressBook.getMarginCalculator();
        calculator = IMarginCalculator(_calculator);
    }

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
