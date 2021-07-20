// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {IGammaAdapter} from "./interfaces/IGammaAdapter.sol";
import {IAddressBook} from "./interfaces/IAddressBook.sol";
import {IGammaController} from "./interfaces/IGammaController.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IMarginCalculator} from "./interfaces/IMarginCalculator.sol";
import {Actions} from "./external/OpynActions.sol";
import {MarginVault} from "./external/OpynVault.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GammaAdapter is IGammaAdapter, Ownable {
    IAddressBook public addressBook;
    IGammaController public controller;
    IWhitelist public whitelist;
    IMarginCalculator public calculator;

    constructor(address _addressBook) {
        setAddressBook(_addressBook);
        refreshConfig();
    }

    function redeem(
        address _otoken,
        uint256 _amount,
        address _to
    ) public override {
        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.Redeem;
        action.secondAddress = _to;
        action.asset = _otoken;
        action.amount = _amount;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        controller.operate(actions);
    }

    function settleVault(address _owner, uint256 _vaultId) public override {
        Actions.ActionArgs memory action;
        action.actionType = Actions.ActionType.SettleVault;
        action.owner = _owner;
        action.vaultId = _vaultId;
        action.secondAddress = _owner;

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0] = action;

        controller.operate(actions);
    }

    function getRedeemPayout(address _otoken, uint256 _amount)
        public
        view
        override
        returns (uint256)
    {
        return controller.getPayout(_otoken, _amount);
    }

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        public
        view
        override
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
        override
        returns (address)
    {
        bool hasShort = _isNotEmpty(_vault.shortOtokens);
        bool hasLong = _isNotEmpty(_vault.longOtokens);

        assert(hasShort || hasLong);

        return hasShort ? _vault.shortOtokens[0] : _vault.longOtokens[0];
    }

    function getExcessCollateral(
        MarginVault.Vault memory _vault,
        uint256 _typeVault
    ) public view override returns (uint256, bool) {
        return calculator.getExcessCollateral(_vault, _typeVault);
    }

    function isSettlementAllowed(address _otoken)
        public
        view
        override
        returns (bool)
    {
        return controller.isSettlementAllowed(_otoken);
    }

    function isWhitelistedOtoken(address _otoken)
        public
        view
        override
        returns (bool)
    {
        return whitelist.isWhitelistedOtoken(_otoken);
    }

    function isOperator(address _owner, address _operator)
        public
        view
        override
        returns (bool)
    {
        return controller.isOperator(_owner, _operator);
    }

    function isValidVaultId(address _owner, uint256 _vaultId)
        public
        view
        override
        returns (bool)
    {
        uint256 vaultCounter = controller.getAccountVaultCounter(_owner);
        return ((_vaultId > 0) && (_vaultId <= vaultCounter));
    }

    function setAddressBook(address _address) public override onlyOwner {
        require(_address != address(0));
        addressBook = IAddressBook(_address);
    }

    function refreshConfig() public override {
        address _controller = addressBook.getController();
        controller = IGammaController(_controller);

        address _whitelist = addressBook.getWhitelist();
        whitelist = IWhitelist(_whitelist);

        address _calculator = addressBook.getMarginCalculator();
        calculator = IMarginCalculator(_calculator);
    }

    function _isNotEmpty(address[] memory _array) internal pure returns (bool) {
        return (_array.length > 0) && (_array[0] != address(0));
    }
}
