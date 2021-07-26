// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.0;

import {Actions} from "../external/OpynActions.sol";
import {MarginVault} from "../external/OpynVault.sol";

interface IGammaControllerV1 {
    function operate(Actions.ActionArgs[] memory _actions) external;

    function isSettlementAllowed(
        address _underlying,
        address _strike,
        address _collateral,
        uint256 _expiry
    ) external view returns (bool);

    function isOperator(address _owner, address _operator)
        external
        view
        returns (bool);

    function getPayout(address _otoken, uint256 _amount)
        external
        view
        returns (uint256);

    function getVault(address _owner, uint256 _vaultId)
        external
        view
        returns (MarginVault.Vault memory);

    function getAccountVaultCounter(address _accountOwner)
        external
        view
        returns (uint256);
}
