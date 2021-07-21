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
  GammaOperatorWrapper__factory,
  GammaOperatorWrapper,
  MockERC20__factory,
} from "../../typechain";
const { time, constants } = require("@openzeppelin/test-helpers");
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { createOtoken, setupGammaContracts } from "../helpers/setup/GammaSetup";

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

  // let expiry: number;
  let usdc: MockERC20;
  let weth: MockERC20;

  // let ethPut: Otoken;

  // const strikePrice = 300;
  // const optionsAmount = 10;
  // const collateralAmount = optionsAmount * strikePrice;

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

    // setup usdc and weth
    const mockERC20Factory = (await ethers.getContractFactory(
      "MockERC20"
    )) as MockERC20__factory;
    usdc = await mockERC20Factory.deploy("USDC", "USDC", usdcDecimals);
    weth = await mockERC20Factory.deploy("WETH", "WETH", wethDecimals);

    // setup whitelist
    await whitelist.whitelistCollateral(usdc.address);
    await whitelist.whitelistCollateral(weth.address);
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true);
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false);
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
    let ethPut: Otoken;
    let expiry: number;
    let strikePrice = 100;

    beforeEach(async () => {
      const now = (await time.latest()).toNumber();
      expiry = createValidExpiry(now, 7);

      ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );
    });

    it("should return correct value after expiry", async () => {
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        strikePrice,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        1,
        true
      );

      expect(await gammaOperator.hasExpiredAndSettlementAllowed(ethPut.address))
        .to.be.false;

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry - 1]);
      await ethers.provider.send("evm_mine", []);
      expect(await gammaOperator.hasExpiredAndSettlementAllowed(ethPut.address))
        .to.be.false;

      await ethers.provider.send("evm_mine", []);
      expect(await gammaOperator.hasExpiredAndSettlementAllowed(ethPut.address))
        .to.be.true;
    });

    it("should return correct value after settled", async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
      expect(await gammaOperator.hasExpiredAndSettlementAllowed(ethPut.address))
        .to.be.false;

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        strikePrice,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        1,
        true
      );

      expect(await gammaOperator.hasExpiredAndSettlementAllowed(ethPut.address))
        .to.be.true;
    });
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
    it("should return same value as Gamma controller", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 7);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits("100", strikePriceDecimals),
        expiry,
        true
      );

      const allowedGammaBefore = await controller.isSettlementAllowed(
        ethPut.address
      );
      const allowedControllerBefore = await gammaOperator.isSettlementAllowed(
        ethPut.address
      );
      expect(allowedGammaBefore).to.be.false;
      expect(allowedGammaBefore).to.be.eq(allowedControllerBefore);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        100,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        1,
        true
      );

      const allowedGammaAfter = await controller.isSettlementAllowed(
        ethPut.address
      );
      const allowedControllerAfter = await gammaOperator.isSettlementAllowed(
        ethPut.address
      );
      expect(allowedGammaAfter).to.be.true;
      expect(allowedGammaAfter).to.be.eq(allowedControllerAfter);
    });
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
