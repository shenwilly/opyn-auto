import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "ethers/lib/ethers";
import { ethers } from "hardhat";
import {
  AddressBook,
  Whitelist,
  MarginPool,
  MarginCalculator,
  Controller,
  OtokenFactory,
  MockOracle,
} from "../../../typechain";

type GammaContracts = [
  AddressBook,
  OtokenFactory,
  Whitelist,
  MockOracle,
  MarginPool,
  MarginCalculator,
  Controller
];

export const setupGammaContracts = async (
  signer?: SignerWithAddress
): Promise<GammaContracts> => {
  // deploy AddressBook
  const AddressBookFactory: ContractFactory = await ethers.getContractFactory(
    "AddressBook",
    signer
  );
  const addressBook = (await AddressBookFactory.deploy()) as AddressBook;

  // deploy OtokenFactory & set address
  const OtokenFactoryFactory: ContractFactory = await ethers.getContractFactory(
    "OtokenFactory",
    signer
  );
  const otokenFactory = (await OtokenFactoryFactory.deploy(
    addressBook.address
  )) as OtokenFactory;
  await addressBook.setOtokenFactory(otokenFactory.address);

  // deploy Otoken implementation & set address
  const OtokenFactory: ContractFactory = await ethers.getContractFactory(
    "Otoken",
    signer
  );
  const oTokenImplementation = await OtokenFactory.deploy();
  await addressBook.setOtokenImpl(oTokenImplementation.address);

  // deploy Whitelist module & set address
  const WhitelistFactory: ContractFactory = await ethers.getContractFactory(
    "Whitelist",
    signer
  );
  const whitelist = (await WhitelistFactory.deploy(
    addressBook.address
  )) as Whitelist;
  await addressBook.setWhitelist(whitelist.address);

  // deploy Oracle module & set address
  const OracleFactory: ContractFactory = await ethers.getContractFactory(
    "MockOracle",
    signer
  );
  const oracle = (await OracleFactory.deploy()) as MockOracle;
  await addressBook.setOracle(oracle.address);

  // deploy MarginPool module & set address
  const MarginPoolFactory: ContractFactory = await ethers.getContractFactory(
    "MarginPool",
    signer
  );
  const marginPool = (await MarginPoolFactory.deploy(
    addressBook.address
  )) as MarginPool;
  await addressBook.setMarginPool(marginPool.address);

  // deploy MarginCalculator module & set address
  const MarginCalculatorFactory: ContractFactory =
    await ethers.getContractFactory("MarginCalculator", signer);
  const calculator = (await MarginCalculatorFactory.deploy(
    oracle.address
  )) as MarginCalculator;
  await addressBook.setMarginCalculator(calculator.address);

  // deploy MarginVault library
  const MarginVaultFactory: ContractFactory = await ethers.getContractFactory(
    "gamma-protocol/contracts/libs/MarginVault.sol:MarginVault",
    signer
  );
  const marginVault = await MarginVaultFactory.deploy();

  // deploy Controller & set address
  const ControllerFactory: ContractFactory = await ethers.getContractFactory(
    "Controller",
    {
      libraries: {
        MarginVault: marginVault.address,
      },
      signer: signer,
    }
  );
  const controller = (await ControllerFactory.deploy()) as Controller;
  await addressBook.setController(controller.address);

  let controllerAddress = await addressBook.getController();
  const controllerProxy = (await ethers.getContractAt(
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
    controllerProxy,
  ];
};
