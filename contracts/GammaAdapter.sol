// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {IGammaAdapter} from "./interfaces/IGammaAdapter.sol";
import {IAddressBook} from "./interfaces/IAddressBook.sol";
import {IGammaController} from "./interfaces/IGammaController.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IMarginCalculator} from "./interfaces/IMarginCalculator.sol";
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

    function isWhitelistedOtoken(address _otoken) public override view returns (bool) {
        return whitelist.isWhitelistedOtoken(_otoken);
    }

    function isValidVault(address _owner, uint256 _vaultId)
        public
        override
        view
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
}
