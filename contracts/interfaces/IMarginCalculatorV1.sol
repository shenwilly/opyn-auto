// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.0;

import {MarginVault} from "../external/OpynVault.sol";

interface IMarginCalculatorV1 {
    function getExcessCollateral(MarginVault.Vault memory _vault)
        external
        view
        returns (uint256, bool);
}
