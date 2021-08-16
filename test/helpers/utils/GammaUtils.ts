import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, BigNumberish, constants } from "ethers/lib/ethers";
import { ethers, network } from "hardhat";
import { OtokenFactory, Otoken, Controller, Oracle } from "../../../typechain";
import { ActionArgs, ActionType } from "../types/GammaTypes";

export const ZERO_ADDR = constants.AddressZero;

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

export const setExpiryPrice = async (
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
  await oracle.connect(ownerSigner).setExpiryPrice(asset, expiry, price);
};
