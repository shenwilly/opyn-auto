// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.0;

import {Actions} from "../OpynActions.sol";

interface IGammaController {
    function operate(Actions.ActionArgs[] memory _actions) external;
}
