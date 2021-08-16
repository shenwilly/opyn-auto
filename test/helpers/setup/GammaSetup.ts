import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, BigNumberish, constants } from "ethers/lib/ethers";
import { ethers } from "hardhat";
import {
  ADDRESS_BOOK_ADDRESS,
  ORACLE_ADDRESS,
} from "../../../constants/address";
import {
  AddressBook,
  Whitelist,
  MarginPool,
  MarginCalculator,
  Controller,
  OtokenFactory,
  Otoken,
  Oracle,
} from "../../../typechain";
import { ActionArgs, ActionType } from "../types/GammaTypes";
const ZERO_ADDR = constants.AddressZero;

type GammaContracts = [
  AddressBook,
  OtokenFactory,
  Whitelist,
  Oracle,
  MarginPool,
  MarginCalculator,
  Controller
];

export const setupGammaContracts = async (): Promise<GammaContracts> => {
  const addressBook = (await ethers.getContractAt(
    "AddressBook",
    ADDRESS_BOOK_ADDRESS
  )) as AddressBook;

  const otokenFactoryAddress = await addressBook.getOtokenFactory();
  const otokenFactory = (await ethers.getContractAt(
    "OtokenFactory",
    otokenFactoryAddress
  )) as OtokenFactory;

  const whitelistAddress = await addressBook.getWhitelist();
  const whitelist = (await ethers.getContractAt(
    "Whitelist",
    whitelistAddress
  )) as Whitelist;

  const oracle = (await ethers.getContractAt(
    "Oracle",
    ORACLE_ADDRESS
  )) as Oracle;

  const marginPoolAddress = await addressBook.getMarginPool();
  const marginPool = (await ethers.getContractAt(
    "MarginPool",
    marginPoolAddress
  )) as MarginPool;

  const calculatorAddress = await addressBook.getMarginCalculator();
  const calculator = (await ethers.getContractAt(
    "MarginCalculator",
    calculatorAddress
  )) as MarginCalculator;

  const controllerAddress = await addressBook.getController();
  const controller = (await ethers.getContractAt(
    "Controller",
    controllerAddress
  )) as Controller;

  return [
    addressBook,
    otokenFactory,
    whitelist,
    oracle,
    marginPool,
    calculator,
    controller,
  ];
};

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
