import { BigNumberish } from "ethers";

export enum ActionType {
  OpenVault,
  MintShortOption,
  BurnShortOption,
  DepositLongOption,
  WithdrawLongOption,
  DepositCollateral,
  WithdrawCollateral,
  SettleVault,
  Redeem,
  Call,
}

export interface ActionArgs {
  actionType: ActionType;
  owner: string;
  secondAddress: string;
  asset: string;
  vaultId: string;
  amount: BigNumberish;
  index: BigNumberish;
  data: string;
}
