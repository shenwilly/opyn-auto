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
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { createOtoken, setupGammaContracts } from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";

const { expect } = chai;
const { time, constants, expectRevert } = require("@openzeppelin/test-helpers");
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

  // let vaultCounter: number;

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

    await usdc.mint(sellerAddress, parseUnits("100000", usdcDecimals));
    await usdc
      .connect(seller)
      .approve(marginPool.address, parseUnits("100000", usdcDecimals));
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
    it("should return the same value as Gamma controller", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 1);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits("10", strikePriceDecimals),
        expiry,
        true
      );

      const collateralAmount = parseUnits("1000", usdcDecimals);
      const shortOptionAmount = parseUnits("1", optionDecimals);

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ZERO_ADDR,
          vaultId: 1,
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: usdc.address,
          vaultId: 1,
          amount: collateralAmount,
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ethPut.address,
          vaultId: 1,
          amount: shortOptionAmount,
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(seller).operate(actionArgs);

      const [vaultGamma, vaultTypeGamma, timestampGamma] =
        await controller.getVaultWithDetails(sellerAddress, 1);
      const [vaultOperator, vaultTypeOperator, timestampOperator] =
        await gammaOperator.getVaultWithDetails(sellerAddress, 1);
      expect(vaultGamma[0][0]).to.be.eq(ethPut.address);
      expect(vaultGamma[0][0]).to.be.eq(vaultOperator[0][0]);

      expect(vaultGamma[2][0]).to.be.eq(usdc.address);
      expect(vaultGamma[2][0]).to.be.eq(vaultOperator[2][0]);
      expect(vaultGamma[3][0]).to.be.eq(vaultOperator[3][0]);
      expect(vaultGamma[5][0]).to.be.eq(vaultOperator[5][0]);

      expect(vaultTypeGamma).to.be.eq(vaultTypeOperator);
      expect(timestampGamma).to.be.eq(timestampOperator);
    });
  });

  describe("getVaultOtoken()", async () => {
    it("should revert if there is no long/short otokens in vault", async () => {
      const vault = {
        shortOtokens: [],
        longOtokens: [],
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };

      await expectRevert(
        gammaOperator.getVaultOtoken(vault),
        "reverted with panic code 0x1 (Assertion error)"
      );
    });
    it("should return correct otoken", async () => {
      const shortVault = {
        shortOtokens: [weth.address], // any address
        longOtokens: [],
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(await gammaOperator.getVaultOtoken(shortVault)).to.be.eq(
        weth.address
      );

      const longVault = {
        shortOtokens: [],
        longOtokens: [usdc.address], // any address
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(await gammaOperator.getVaultOtoken(longVault)).to.be.eq(
        usdc.address
      );

      const longShortVault = {
        shortOtokens: [weth.address], // any address
        longOtokens: [usdc.address], // any address
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(await gammaOperator.getVaultOtoken(longShortVault)).to.be.eq(
        weth.address
      );
    });
  });

  describe("getExcessCollateral()", async () => {
    it("should return the same value as Gamma calculator", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 1);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits("100", strikePriceDecimals),
        expiry,
        true
      );

      const vault = {
        shortOtokens: [ethPut.address],
        longOtokens: [],
        collateralAssets: [usdc.address],
        shortAmounts: [1],
        longAmounts: [],
        collateralAmounts: [200],
      };

      const [excessOperator, isExcessOperator] =
        await gammaOperator.getExcessCollateral(vault, 0);
      const [excessGamma, isExcessGamma] = await calculator.getExcessCollateral(
        vault,
        0
      );

      expect(excessOperator).to.be.eq(excessGamma);
      expect(isExcessOperator).to.be.eq(isExcessGamma);

      // TODO: More cases
    });
  });

  describe("isSettlementAllowed()", async () => {
    it("should return the same value as Gamma controller", async () => {
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
      const allowedOperatorBefore = await gammaOperator.isSettlementAllowed(
        ethPut.address
      );
      expect(allowedGammaBefore).to.be.false;
      expect(allowedGammaBefore).to.be.eq(allowedOperatorBefore);

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
      const allowedOperatorAfter = await gammaOperator.isSettlementAllowed(
        ethPut.address
      );
      expect(allowedGammaAfter).to.be.true;
      expect(allowedGammaAfter).to.be.eq(allowedOperatorAfter);
    });
  });

  describe("isOperatorOf()", async () => {
    it("should return the same value as Gamma controller", async () => {
      await controller.connect(buyer).setOperator(gammaOperator.address, true);
      const isOperatorGammaBefore = await controller.isOperator(
        buyerAddress,
        gammaOperator.address
      );
      const isOperatorOperatorBefore = await gammaOperator.isOperatorOf(
        buyerAddress
      );
      expect(isOperatorGammaBefore).to.be.true;
      expect(isOperatorOperatorBefore).to.be.eq(isOperatorOperatorBefore);

      await controller.connect(buyer).setOperator(gammaOperator.address, false);

      const isOperatorGammaAfter = await controller.isOperator(
        buyerAddress,
        gammaOperator.address
      );
      const isOperatorOperatorAfter = await gammaOperator.isOperatorOf(
        buyerAddress
      );
      expect(isOperatorGammaAfter).to.be.false;
      expect(isOperatorGammaAfter).to.be.eq(isOperatorOperatorAfter);
    });
  });

  describe("isWhitelistedOtoken()", async () => {
    it("should return the same value as Gamma controller", async () => {
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

      const isWhitelistedGammaBefore = await whitelist.isWhitelistedOtoken(
        deployerAddress
      );
      const isWhitelistedOperatorBefore =
        await gammaOperator.isWhitelistedOtoken(deployerAddress);
      expect(isWhitelistedGammaBefore).to.be.false;
      expect(isWhitelistedGammaBefore).to.be.eq(isWhitelistedOperatorBefore);

      const isWhitelistedGammaAfter = await whitelist.isWhitelistedOtoken(
        ethPut.address
      );
      const isWhitelistedOperatorAfter =
        await gammaOperator.isWhitelistedOtoken(ethPut.address);
      expect(isWhitelistedGammaAfter).to.be.true;
      expect(isWhitelistedGammaAfter).to.be.eq(isWhitelistedOperatorAfter);
    });
  });

  describe("isValidVaultId()", async () => {
    it("should return false if vaultId is zero", async () => {
      expect(await gammaOperator.isValidVaultId(buyerAddress, 0)).to.be.false;
    });
    it("should return false if vault does not exist", async () => {
      expect(await gammaOperator.isValidVaultId(buyerAddress, 1)).to.be.false;
    });
    it("should return true if vault exists", async () => {
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: buyerAddress,
          secondAddress: buyerAddress,
          asset: ZERO_ADDR,
          vaultId: 1,
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(buyer).operate(actionArgs);
      expect(await gammaOperator.isValidVaultId(buyerAddress, 1)).to.be.true;
    });
  });
});
