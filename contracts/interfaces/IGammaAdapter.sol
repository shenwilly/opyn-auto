// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

interface IGammaAdapter {
    function isWhitelistedOtoken(address _otoken) external view returns (bool);

    function isValidVault(address _owner, uint256 _vaultId)
        external
        view
        returns (bool);

    function setAddressBook(address _address) external;

    function refreshConfig() external;
}
