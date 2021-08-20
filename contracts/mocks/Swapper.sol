// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {GammaRedeemerV1} from "../GammaRedeemerV1.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Swapper is GammaRedeemerV1 {
    using SafeERC20 for IERC20;

    constructor(
        address _gammaAddressBook,
        address _uniRouter,
        address _automator,
        address _automatorTreasury
    )
        GammaRedeemerV1(
            _gammaAddressBook,
            _uniRouter,
            _automator,
            _automatorTreasury
        )
    {}

    function approve(
        address _token,
        address _spender,
        uint256 _amount
    ) public {
        IERC20(_token).approve(_spender, _amount);
    }

    function swapToken(
        uint256 _amountIn,
        uint256 _amountOutMin,
        address[] calldata _path
    ) public {
        swap(_amountIn, _amountOutMin, _path);
    }
}
