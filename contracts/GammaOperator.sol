// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {IGammaAdapter} from "./interfaces/IGammaAdapter.sol";
import {MarginVault} from "./external/OpynVault.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOtoken} from "./interfaces/IOtoken.sol";

contract GammaOperator is Ownable {
    using SafeERC20 for IERC20;

    IGammaAdapter gamma;

    constructor(address _gamma) {
        gamma = IGammaAdapter(_gamma);
    }

    function redeemOtoken(
        address _owner,
        address _otoken,
        uint256 _amount
    ) internal {
        uint256 actualAmount = getRedeemableAmount(_owner, _otoken, _amount);

        IERC20(_otoken).safeTransferFrom(_owner, address(this), actualAmount);

        gamma.redeem(_otoken, actualAmount, _owner);
    }

    function settleVault(address _owner, uint256 _vaultId) internal {
        gamma.settleVault(_owner, _vaultId);
    }

    function isWhitelistedOtoken(address _otoken) public view returns (bool) {
        return gamma.isWhitelistedOtoken(_otoken);
    }

    function isValidVaultId(address _owner, uint256 _vaultId)
        public
        view
        returns (bool)
    {
        return gamma.isValidVaultId(_owner, _vaultId);
    }

    function shouldRedeemOtoken(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public view returns (bool) {
        if (!hasExpiredAndSettlementAllowed(_otoken)) return false;

        uint256 actualAmount = getRedeemableAmount(_owner, _otoken, _amount);
        uint256 payout = gamma.getRedeemPayout(_otoken, actualAmount);
        if (payout == 0) return false;

        return true;
    }

    function shouldSettleVault(address _owner, uint256 _vaultId)
        public
        view
        returns (bool)
    {
        if (!isValidVaultId(_owner, _vaultId) || !isOperatorOf(_owner))
            return false;

        (MarginVault.Vault memory vault, uint256 typeVault, ) = gamma
            .getVaultWithDetails(_owner, _vaultId);

        try gamma.getVaultOtoken(vault) returns (address otoken) {
            if (!hasExpiredAndSettlementAllowed(otoken)) return false;

            (uint256 payout, bool isValidVault) = gamma.getExcessCollateral(
                vault,
                typeVault
            );
            if (!isValidVault || payout == 0) return false;
        } catch {
            return false;
        }

        return true;
    }

    function isOperatorOf(address _owner) public view returns (bool) {
        return gamma.isOperator(_owner, address(this));
    }

    function hasExpiredAndSettlementAllowed(address _otoken)
        public
        view
        returns (bool)
    {
        bool hasExpired = block.timestamp >= IOtoken(_otoken).expiryTimestamp();
        if (!hasExpired) return false;

        bool isAllowed = gamma.isSettlementAllowed(_otoken);
        (_otoken);
        if (!isAllowed) return false;

        return true;
    }

    function setGammaAdapter(address _gamma) public onlyOwner {
        gamma = IGammaAdapter(_gamma);
    }

    function getRedeemableAmount(
        address _owner,
        address _otoken,
        uint256 _amount
    ) public view returns (uint256) {
        uint256 ownerBalance = IERC20(_otoken).balanceOf(_owner);
        uint256 allowance = IERC20(_otoken).allowance(_owner, address(this));
        uint256 spendable = min(ownerBalance, allowance);
        return min(_amount, spendable);
    }

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
