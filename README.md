# Opyn Gamma Automator

Automator contract for redeeming oTokens and/or settling vaults on [Opyn Gamma protocol](https://github.com/opynfinance/GammaProtocol), powered by [Gelato](https://github.com/gelatodigital/poke-me).

- Option holders can automatically redeem their options if it expires ITM.
- Option writers can automatically settle their vaults after the vault's oToken have been settled.

The contract will take a small portion of proceed to cover gas cost.

## Setup

### Install
`yarn`

### Compile & test contracts
`yarn build && yarn test`

### Deploy contracts
`npx hardhat run --network ropsten scripts/deploy.ts`

### Provide ETH funds to Gelato
`npx hardhat run --network ropsten scripts/provideFund.ts`

## Related Links
[Frontend](https://github.com/shenwilly/opyn-auto-ui)

[Subgraph](https://github.com/shenwilly/opyn-auto-graph)
