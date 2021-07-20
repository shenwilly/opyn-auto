// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {IGammaAdapter} from "./interfaces/IGammaAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GammaOperator is Ownable {
    IGammaAdapter gamma;

    constructor(address _gamma) {
        gamma = IGammaAdapter(_gamma);
    }

    function redeemOtoken(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public {}

    function settleVault(address _owner, uint256 _vaultId) public {}

    function isWhitelistedOtoken(address _otoken) public view returns (bool) {
        return gamma.isWhitelistedOtoken(_otoken);
    }

    function isValidVault(address _owner, uint256 _vaultId)
        public
        view
        returns (bool)
    {
        return gamma.isValidVault(_owner, _vaultId);
    }

    function shouldRedeemOtoken(address _otoken) public view returns (bool) {
        return true;
    }

    function shouldSettleVault(address _owner, uint256 vaultId)
        public
        view
        returns (bool)
    {
        return true;
    }

    function setGammaAdapter(address _gamma) public onlyOwner {
        gamma = IGammaAdapter(_gamma);
    }
}
