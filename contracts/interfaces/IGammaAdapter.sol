// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {MarginVault} from "../external/OpynVault.sol";

interface IGammaAdapter {
    function redeem(
        address _otoken,
        uint256 _amount,
        address _to
    ) external;

    function settleVault(address _owner, uint256 _vaultId) external;

    function getRedeemPayout(address _otoken, uint256 _amount)
        external
        view
        returns (uint256);

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        external
        view
        returns (
            MarginVault.Vault memory,
            uint256,
            uint256
        );

    function getVaultOtoken(MarginVault.Vault memory _vault)
        external
        pure
        returns (address);

    function getExcessCollateral(
        MarginVault.Vault memory vault,
        uint256 typeVault
    ) external view returns (uint256, bool);

    function isSettlementAllowed(address _otoken) external view returns (bool);

    function isWhitelistedOtoken(address _otoken) external view returns (bool);

    function isOperator(address _owner, address _operator)
        external
        view
        returns (bool);

    function isValidVaultId(address _owner, uint256 _vaultId)
        external
        view
        returns (bool);

    function setAddressBook(address _address) external;

    function refreshConfig() external;
}
