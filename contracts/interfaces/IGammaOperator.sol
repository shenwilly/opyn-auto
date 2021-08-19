// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {MarginVault} from "../external/OpynVault.sol";

interface IGammaOperator {
    function isValidVaultId(address _owner, uint256 _vaultId)
        external
        view
        returns (bool);

    function getExcessCollateral(
        MarginVault.Vault memory _vault,
        uint256 _typeVault
    ) external view returns (uint256, bool);

    function getVaultOtoken(MarginVault.Vault memory _vault)
        external
        pure
        returns (address);
    
    function getVaultOtoken(address _owner, uint256 _vaultId)
        external
        view
        returns (address);

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        external
        view
        returns (
            MarginVault.Vault memory,
            uint256,
            uint256
        );
    
    function getOtokenCollateral(address _otoken)
        external
        pure
        returns (address);

    function isSettlementAllowed(address _otoken) external view returns (bool);

    function isOperatorOf(address _owner) external view returns (bool);

    function hasExpiredAndSettlementAllowed(address _otoken)
        external
        view
        returns (bool);
}
