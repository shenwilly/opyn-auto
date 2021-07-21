// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import "hardhat/console.sol";
import {IAddressBook} from "./interfaces/IAddressBook.sol";
import {IGammaController} from "./interfaces/IGammaController.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IMarginCalculator} from "./interfaces/IMarginCalculator.sol";
import {Actions} from "./external/OpynActions.sol";
import {MarginVault} from "./external/OpynVault.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOtoken} from "./interfaces/IOtoken.sol";

contract GammaOperator is Ownable {
    using SafeERC20 for IERC20;

    IAddressBook public addressBook;
    IGammaController public controller;
    IWhitelist public whitelist;
    IMarginCalculator public calculator;

    constructor(address _addressBook) {
        setAddressBook(_addressBook);
        refreshConfig();
    }

    function redeemOtoken(
        address _owner,
        address _otoken,
        uint256 _amount
    ) internal {
        uint256 actualAmount = getRedeemableAmount(_owner, _otoken, _amount);

        IERC20(_otoken).safeTransferFrom(_owner, address(this), actualAmount);

        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.Redeem;
        action.secondAddress = _owner;
        action.asset = _otoken;
        action.amount = _amount;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        controller.operate(actions);
    }

    function settleVault(address _owner, uint256 _vaultId) internal {
        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.SettleVault;
        action.owner = _owner;
        action.vaultId = _vaultId;
        action.secondAddress = _owner;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        controller.operate(actions);
    }

    function shouldRedeemOtoken(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public view returns (bool) {
        if (!hasExpiredAndSettlementAllowed(_otoken)) return false;

        uint256 actualAmount = getRedeemableAmount(_owner, _otoken, _amount);
        uint256 payout = getRedeemPayout(_otoken, actualAmount);
        if (payout == 0) return false;

        return true;
    }

    function shouldSettleVault(address _owner, uint256 _vaultId)
        public
        view
        returns (bool)
    {
        if (!isValidVaultId(_owner, _vaultId) || !isOperatorOf(_owner))
            return false;

        (
            MarginVault.Vault memory vault,
            uint256 typeVault,

        ) = getVaultWithDetails(_owner, _vaultId);

        try this.getVaultOtoken(vault) returns (address otoken) {
            if (!hasExpiredAndSettlementAllowed(otoken)) return false;

            (uint256 payout, bool isValidVault) = getExcessCollateral(
                vault,
                typeVault
            );
            if (!isValidVault || payout == 0) return false;
        } catch {
            return false;
        }

        return true;
    }

    function hasExpiredAndSettlementAllowed(address _otoken)
        public
        view
        returns (bool)
    {
        bool hasExpired = block.timestamp >= IOtoken(_otoken).expiryTimestamp();
        if (!hasExpired) return false;

        bool isAllowed = isSettlementAllowed(_otoken);
        if (!isAllowed) return false;

        return true;
    }

    function setAddressBook(address _address) public onlyOwner {
        require(
            _address != address(0),
            "GammaOperator::setAddressBook: Address must not be zero"
        );
        addressBook = IAddressBook(_address);
    }

    function refreshConfig() public {
        address _controller = addressBook.getController();
        controller = IGammaController(_controller);

        address _whitelist = addressBook.getWhitelist();
        whitelist = IWhitelist(_whitelist);

        address _calculator = addressBook.getMarginCalculator();
        calculator = IMarginCalculator(_calculator);
    }

    function getRedeemPayout(address _otoken, uint256 _amount)
        public
        view
        returns (uint256)
    {
        return controller.getPayout(_otoken, _amount);
    }

    function getRedeemableAmount(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public view returns (uint256) {
        uint256 ownerBalance = IERC20(_otoken).balanceOf(_owner);
        uint256 allowance = IERC20(_otoken).allowance(_owner, address(this));
        uint256 spendable = min(ownerBalance, allowance);
        return min(_amount, spendable);
    }

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        public
        view
        returns (
            MarginVault.Vault memory,
            uint256,
            uint256
        )
    {
        return controller.getVaultWithDetails(_owner, _vaultId);
    }

    function getVaultOtoken(MarginVault.Vault memory _vault)
        public
        pure
        returns (address)
    {
        bool hasShort = isNotEmpty(_vault.shortOtokens);
        bool hasLong = isNotEmpty(_vault.longOtokens);

        assert(hasShort || hasLong);

        return hasShort ? _vault.shortOtokens[0] : _vault.longOtokens[0];
    }

    function getExcessCollateral(
        MarginVault.Vault memory _vault,
        uint256 _typeVault
    ) public view returns (uint256, bool) {
        return calculator.getExcessCollateral(_vault, _typeVault);
    }

    function isSettlementAllowed(address _otoken) public view returns (bool) {
        return controller.isSettlementAllowed(_otoken);
    }

    function isOperatorOf(address _owner) public view returns (bool) {
        return controller.isOperator(_owner, address(this));
    }

    function isWhitelistedOtoken(address _otoken) public view returns (bool) {
        return whitelist.isWhitelistedOtoken(_otoken);
    }

    function isValidVaultId(address _owner, uint256 _vaultId)
        public
        view
        returns (bool)
    {
        uint256 vaultCounter = controller.getAccountVaultCounter(_owner);
        return ((_vaultId > 0) && (_vaultId <= vaultCounter));
    }

    function isNotEmpty(address[] memory _array) private pure returns (bool) {
        return (_array.length > 0) && (_array[0] != address(0));
    }

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
