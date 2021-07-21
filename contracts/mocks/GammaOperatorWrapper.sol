// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaOperator} from "../GammaOperator.sol";

contract GammaOperatorWrapper is GammaOperator {
    constructor(address _gammaAddressBook) GammaOperator(_gammaAddressBook) {}

    function redeem(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public {
        redeemOtoken(_owner, _otoken, _amount);
    }

    function settle(address _owner, uint256 _vaultId) public {
        settleVault(_owner, _vaultId);
    }
}
