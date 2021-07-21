import { ethers } from "hardhat";
import chai from "chai";
import {
  AddressBook,
  OtokenFactory,
  Whitelist,
  Controller,
  Otoken,
  MarginPool,
  MarginCalculator,
  MockOracle,
  MockERC20,
  MockERC20__factory,
  GammaRedeemerV1__factory,
  GammaRedeemerV1,
  GammaOperatorWrapper__factory,
  GammaOperatorWrapper,
} from "../../typechain";
const { time, constants } = require("@openzeppelin/test-helpers");
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";

const { expect } = chai;
const ZERO_ADDR = constants.ZERO_ADDRESS;

describe("GammaRedeemer", () => {
  let deployer: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let deployerAddress: string;
  let buyerAddress: string;
  let sellerAddress: string;

  let addressBook: AddressBook;
  let otokenFactory: OtokenFactory;
  let whitelist: Whitelist;
  let marginPool: MarginPool;
  let calculator: MarginCalculator;
  let oracle: MockOracle;
  let controller: Controller;
  let gammaOperator: GammaOperatorWrapper;

  let expiry: number;
  let usdc: MockERC20;
  let weth: MockERC20;

  let ethPut: Otoken;

  const strikePrice = 300;
  const optionsAmount = 10;
  const collateralAmount = optionsAmount * strikePrice;

  let vaultCounter: number;

  const strikePriceDecimals = 8;
  const optionDecimals = 8;
  const usdcDecimals = 6;
  const wethDecimals = 18;

  before("setup contracts", async () => {
    [deployer, buyer, seller] = await ethers.getSigners();
    deployerAddress = deployer.address;
    buyerAddress = buyer.address;
    sellerAddress = seller.address;

    [
      addressBook,
      otokenFactory,
      whitelist,
      oracle,
      marginPool,
      calculator,
      controller,
    ] = await setupGammaContracts(deployer);

    const GammaOperatorWrapperFactory = (await ethers.getContractFactory(
      "GammaOperatorWrapper",
      deployer
    )) as GammaOperatorWrapper__factory;
    gammaOperator = await GammaOperatorWrapperFactory.deploy(
      addressBook.address
    );
  });

  describe("redeemOtoken()", async () => {
    it("Redeem", async () => {});
  });

  describe("settleVault()", async () => {
    it("Redeem", async () => {});
  });

  describe("shouldRedeemOtoken()", async () => {
    it("Redeem", async () => {});
  });

  describe("shouldSettleVault()", async () => {
    it("Redeem", async () => {});
  });

  describe("hasExpiredAndSettlementAllowed()", async () => {
    it("Redeem", async () => {});
  });

  describe("setAddressBook()", async () => {
    it("Redeem", async () => {});
  });

  describe("refreshConfig()", async () => {
    it("Redeem", async () => {});
  });

  describe("getRedeemPayout()", async () => {
    it("Redeem", async () => {});
  });

  describe("getRedeemableAmount()", async () => {
    it("Redeem", async () => {});
  });

  describe("getVaultWithDetails()", async () => {
    it("Redeem", async () => {});
  });

  describe("getVaultOtoken()", async () => {
    it("Redeem", async () => {});
  });

  describe("getExcessCollateral()", async () => {
    it("Redeem", async () => {});
  });

  describe("isSettlementAllowed()", async () => {
    it("Redeem", async () => {});
  });

  describe("isOperator()", async () => {
    it("Redeem", async () => {});
  });

  describe("isWhitelistedOtoken()", async () => {
    it("Redeem", async () => {});
  });

  describe("isValidVaultId()", async () => {
    it("Redeem", async () => {});
  });

  describe("isNotEmpty()", async () => {
    it("Redeem", async () => {});
  });

  describe("min()", async () => {
    it("Redeem", async () => {});
  });
});
