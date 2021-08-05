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

    function getProcessableOrders()
        public
        view
        override
        returns (uint256[] memory)
    {
        IGammaRedeemerV1.Order[] memory orders = redeemer.getOrders();

        bytes32[] memory preCheckHashes = new bytes32[](orders.length);
        uint256 executableOrderTotal;
        for (uint256 i = 0; i < orders.length; i++) {
            if (redeemer.shouldProcessOrder(i)) {
                // Only proceess duplicate orders one at a time
                bytes32 orderHash;
                if (orders[i].isSeller) {
                    orderHash = keccak256(
                        abi.encode(orders[i].owner, orders[i].vaultId)
                    );
                } else {
                    orderHash = keccak256(
                        abi.encode(orders[i].owner, orders[i].otoken)
                    );
                }

                bool sameOrderType;
                for (uint256 j = 0; j < preCheckHashes.length; j++) {
                    if (preCheckHashes[j] == orderHash) {
                        sameOrderType = true;
                        break;
                    }
                }

                if (!sameOrderType) {
                    preCheckHashes[i] = orderHash;
                    executableOrderTotal++;
                }
            }
        }

        bytes32[] memory postCheckHashes = new bytes32[](orders.length);
        uint256 counter;
        uint256[] memory orderIds = new uint256[](executableOrderTotal);
        for (uint256 i = 0; i < orders.length; i++) {
            if (redeemer.shouldProcessOrder(i)) {
                bytes32 orderHash;
                if (orders[i].isSeller) {
                    orderHash = keccak256(
                        abi.encode(orders[i].owner, orders[i].vaultId)
                    );
                } else {
                    orderHash = keccak256(
                        abi.encode(orders[i].owner, orders[i].otoken)
                    );
                }

                bool sameOrderType;
                for (uint256 j = 0; j < postCheckHashes.length; j++) {
                    if (postCheckHashes[j] == orderHash) {
                        sameOrderType = true;
                        break;
                    }
                }

                if (!sameOrderType) {
                    orderIds[counter] = i;
                    counter++;
                }
            }
        }
        return orderIds;
    }
}
