// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.0;

interface IPokeMe {
    function createTask(address _taskAddress, bytes calldata _taskData)
        external;

    function cancelTask(address _taskAddress, bytes calldata _taskData)
        external;
}
