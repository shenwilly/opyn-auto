// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import {IGammaController} from "./interfaces/IGammaController.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IAddressBook} from "./interfaces/IAddressBook.sol";
import {IOtoken} from "./interfaces/IOtoken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Actions} from "./OpynActions.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GammaRedeemer is Ownable {
    using SafeERC20 for IERC20;

    struct AutoRedeemOrder {
        address owner;
        address otoken;
        uint256 amount;
        bool toETH;
        bool finished;
    }

    IGammaController public controller;
    IWhitelist public whitelist;
    IAddressBook public addressBook;
    // IUniswapV2Router02 public uniswapRouter;
    AutoRedeemOrder[] public orders;
    mapping(bytes => uint256) public orderIds;

    event AutoRedeemOrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address indexed otoken,
        uint256 amount
    );
    event AutoRedeemOrderFinished(
        uint256 indexed orderId,
        bool indexed cancelled
    );

    constructor(address _addressBook) {
        setAddressBook(_addressBook);
        refreshConfig();
    }

    function createAutoRedeemOrder(address _otoken, uint256 _amount) public {
        require(
            whitelist.isWhitelistedOtoken(_otoken),
            "GammaRedeemer::createAutoRedeemOrder: Otoken not whitelisted"
        );

        bytes memory orderHash = abi.encodePacked(msg.sender, _otoken);
        require(
            orderIds[orderHash] == 0,
            "GammaRedeemer::createAutoRedeemOrder: Order already exist"
        );

        AutoRedeemOrder memory order;
        order.owner = msg.sender;
        order.otoken = _otoken;
        order.amount = _amount;
        orders.push(order);

        uint256 orderId = orders.length; // use 0 as empty
        orderIds[orderHash] = orderId;

        emit AutoRedeemOrderCreated(orderId, msg.sender, _otoken, _amount);
    }

    function cancelAutoRedeemOrder(uint256 _orderId) public {
        require(
            orders[_orderId].owner == msg.sender,
            "GammaRedeemer::updateAutoRedeemOrder: Sender is not order owner"
        );
        require(
            !orders[_orderId].finished,
            "GammaRedeemer::updateAutoRedeemOrder: Order is already finished"
        );

        orders[_orderId].finished = true;

        // cancel auto task

        emit AutoRedeemOrderFinished(_orderId, true);
    }

    function shouldRedeem(uint256 _orderId) public view returns (bool) {
        // check if
        return true;
    }

    function redeem(uint256 _orderId) public {
        // require only keeper

        // check if options ITM
        require(shouldRedeem(_orderId), "");

        AutoRedeemOrder storage order = orders[_orderId];
        order.finished = true;

        address otoken = order.otoken;
        address owner = order.owner;
        uint256 amount = order.amount;

        IERC20(otoken).safeTransferFrom(owner, address(this), amount);

        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.Redeem;
        action.secondAddress = owner;
        action.asset = otoken;
        action.amount = amount;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        address collateral = IOtoken(otoken).collateralAsset();

        uint256 amountBefore = IERC20(collateral).balanceOf(address(this));
        controller.operate(actions);
        uint256 amountAfter = IERC20(collateral).balanceOf(address(this));

        uint256 difference = amountAfter - amountBefore;
        assert(difference > 0);

        IERC20(otoken).safeTransfer(owner, difference);

        emit AutoRedeemOrderFinished(_orderId, false);
    }

    function setAddressBook(address _address) public onlyOwner {
        require(_address != address(0));
        addressBook = IAddressBook(_address);
    }

    function refreshConfig() public {
        address _controller = addressBook.getController();
        controller = IGammaController(_controller);

        address _whitelist = addressBook.getWhitelist();
        whitelist = IWhitelist(_whitelist);
    }
}
