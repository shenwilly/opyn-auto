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
  Oracle,
} from "../../../typechain";

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
