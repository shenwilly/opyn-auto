// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import {IGammaRedeemerV1} from "./interfaces/IGammaRedeemerV1.sol";
import {IResolver} from "./interfaces/IResolver.sol";

/// @author Willy Shen
/// @title GammaRedeemer Resolver
/// @notice A GammaRedeemer resolver for Gelato PokeMe checks
contract GammaRedeemerResolver is IResolver {
    IGammaRedeemerV1 redeemer;

    constructor(address _redeemer) {
        redeemer = IGammaRedeemerV1(_redeemer);
    }

    // check if order can be processed without a revert
    function canProcessOrder(uint256 _orderId) public view returns (bool) {
        return true;
    }

    function getProcessableOrders()
        public
        view
        override
        returns (uint256[] memory)
    {
        IGammaRedeemerV1.Order[] memory orders = redeemer.getOrders();

        // Only proceess duplicate orders one at a time
        bytes32[] memory preCheckHashes = new bytes32[](orders.length);
        bytes32[] memory postCheckHashes = new bytes32[](orders.length);

        uint256 orderIdLength;
        for (uint256 i = 0; i < orders.length; i++) {
            if (
                redeemer.shouldProcessOrder(i) &&
                canProcessOrder(i) &&
                !containDuplicateOrderType(orders[i], preCheckHashes)
            ) {
                preCheckHashes[i] = getOrderHash(orders[i]);
                orderIdLength++;
            }
        }

        uint256 counter;
        uint256[] memory orderIds = new uint256[](orderIdLength);
        for (uint256 i = 0; i < orders.length; i++) {
            if (
                redeemer.shouldProcessOrder(i) &&
                canProcessOrder(i) &&
                !containDuplicateOrderType(orders[i], postCheckHashes)
            ) {
                postCheckHashes[i] = getOrderHash(orders[i]);
                orderIds[counter] = i;
                counter++;
            }
        }
        return orderIds;
    }

    function containDuplicateOrderType(
        IGammaRedeemerV1.Order memory order,
        bytes32[] memory hashes
    ) public pure returns (bool containDuplicate) {
        bytes32 orderHash = getOrderHash(order);

        for (uint256 j = 0; j < hashes.length; j++) {
            if (hashes[j] == orderHash) {
                containDuplicate = true;
                break;
            }
        }
    }

    function getOrderHash(IGammaRedeemerV1.Order memory order)
        public
        pure
        returns (bytes32 orderHash)
    {
        if (order.isSeller) {
            orderHash = keccak256(abi.encode(order.owner, order.vaultId));
        } else {
            orderHash = keccak256(abi.encode(order.owner, order.otoken));
        }
    }
}
