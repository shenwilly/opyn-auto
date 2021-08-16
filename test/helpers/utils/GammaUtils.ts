import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, BigNumberish } from "ethers/lib/ethers";
import { ethers, network } from "hardhat";
import { ZERO_ADDR } from "../../../constants/address";
import {
  OtokenFactory,
  Otoken,
  Controller,
  Oracle,
  Whitelist,
} from "../../../typechain";
import { ActionArgs, ActionType } from "../types/GammaTypes";

export const createOtoken = async (
  factory: OtokenFactory,
  underlying: string,
  strike: string,
  collateral: string,
  strikePrice: BigNumber,
  expiry: BigNumberish,
  isPut: boolean
): Promise<Otoken> => {
  await factory.createOtoken(
    underlying,
    strike,
    collateral,
    strikePrice,
    expiry,
    isPut
  );
  const ethPutAddress = await factory.getOtoken(
    underlying,
    strike,
    collateral,
    strikePrice,
    expiry,
    isPut
  );

  const put = (await ethers.getContractAt("Otoken", ethPutAddress)) as Otoken;
  return put;
};

export const setOperator = async (
  signer: SignerWithAddress,
  controller: Controller,
  operator: string,
  value: boolean
) => {
  const isOperator = await controller.isOperator(signer.address, operator);
  if (isOperator !== value) {
    await controller.connect(signer).setOperator(operator, value);
  }
};

export const getActionOpenVault = (
  owner: string,
  vaultId: string
): ActionArgs => {
  return {
    actionType: ActionType.OpenVault,
    owner: owner,
    secondAddress: owner,
    asset: ZERO_ADDR,
    vaultId: vaultId,
    amount: "0",
    index: "0",
    data: ZERO_ADDR,
  };
};

export const getActionDepositCollateral = (
  owner: string,
  vaultId: string,
  asset: string,
  amount: BigNumber
): ActionArgs => {
  return {
    actionType: ActionType.DepositCollateral,
    owner: owner,
    secondAddress: owner,
    asset: asset,
    vaultId: vaultId,
    amount: amount,
    index: "0",
    data: ZERO_ADDR,
  };
};

export const getActionMintShort = (
  owner: string,
  vaultId: string,
  otoken: string,
  amount: BigNumber
): ActionArgs => {
  return {
    actionType: ActionType.MintShortOption,
    owner: owner,
    secondAddress: owner,
    asset: otoken,
    vaultId: vaultId.toString(),
    amount: amount,
    index: "0",
    data: ZERO_ADDR,
  };
};

export const setExpiryPriceAndEndDisputePeriod = async (
  oracle: Oracle,
  asset: string,
  expiry: BigNumberish,
  price: BigNumberish
) => {
  const owner = await oracle.owner();

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [owner],
  });
  const ownerSigner = await ethers.getSigner(owner);

  const [funder] = await ethers.getSigners();
  await funder.sendTransaction({
    to: owner,
    value: parseEther("1"),
  });

  await oracle.connect(ownerSigner).setAssetPricer(asset, owner);
  await oracle.connect(ownerSigner).setDisputePeriod(owner, 0);
  await oracle.connect(ownerSigner).setExpiryPrice(asset, expiry, price);
  await ethers.provider.send("evm_mine", []);
};

export const whitelistCollateral = async (
  whitelist: Whitelist,
  collateral: string
) => {
  const isWhitelisted = await whitelist.isWhitelistedCollateral(collateral);
  if (!isWhitelisted) {
    await whitelist.whitelistCollateral(collateral);
  }
};

export const whitelistProduct = async (
  whitelist: Whitelist,
  underlying: string,
  strike: string,
  collateral: string,
  isPut: boolean
) => {
  const isWhitelisted = await whitelist.isWhitelistedProduct(
    underlying,
    strike,
    collateral,
    isPut
  );

  if (!isWhitelisted) {
    await whitelist.whitelistProduct(underlying, strike, collateral, isPut);
  }
};

export const getOrCreateOtoken = async (
  factory: OtokenFactory,
  underlying: string,
  strike: string,
  collateral: string,
  strikePrice: BigNumberish,
  expiry: BigNumberish,
  isPut: boolean
) => {
  let otoken = await factory.getOtoken(
    underlying,
    strike,
    collateral,
    strikePrice,
    expiry,
    isPut
  );

  if (otoken == ZERO_ADDR) {
    await factory.createOtoken(
      underlying,
      strike,
      collateral,
      strikePrice,
      expiry,
      isPut
    );
    otoken = await factory.getOtoken(
      underlying,
      strike,
      collateral,
      strikePrice,
      expiry,
      isPut
    );
  }

  return otoken;
};
