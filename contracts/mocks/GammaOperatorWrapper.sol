// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaOperator} from "../GammaOperator.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GammaOperatorWrapper is GammaOperator {
    using SafeERC20 for IERC20;

    constructor(address _gammaAddressBook) GammaOperator(_gammaAddressBook) {}

    function redeem(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public {
        (address payoutToken, uint256 payoutAmount) = redeemOtoken(
            _owner,
            _otoken,
            _amount
        );
        IERC20(payoutToken).safeTransfer(_owner, payoutAmount);
    }

    function settle(address _owner, uint256 _vaultId) public {
        (address payoutToken, uint256 payoutAmount) = settleVault(
            _owner,
            _vaultId
        );
        IERC20(payoutToken).safeTransfer(_owner, payoutAmount);
    }
}
