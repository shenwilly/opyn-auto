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
import { parseEther, parseUnits } from "ethers/lib/utils";
import {
  createOtoken,
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setupGammaContracts,
} from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";
import { constants } from "ethers/lib/ethers";
import { ETH_TOKEN_ADDRESS } from "../helpers/constants";

const { expect } = chai;
const { time, expectRevert } = require("@openzeppelin/test-helpers");
const ZERO_ADDR = constants.AddressZero;

describe("GammaOperator", () => {
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

  let usdc: MockERC20;
  let weth: MockERC20;

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
    it("should redeem otoken correctly", async () => {
      let strikePrice = 200;
      let collateralAmount = parseUnits("1000", usdcDecimals);
      let shortOptionAmount = parseUnits("1", optionDecimals);
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 19);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          shortOptionAmount
        ),
      ];
      await controller.connect(seller).operate(actionArgs);
      await ethPut.connect(seller).transfer(buyerAddress, shortOptionAmount);
      await ethPut
        .connect(buyer)
        .approve(gammaOperator.address, shortOptionAmount);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );

      const usdcBalanceBefore = await usdc.balanceOf(buyerAddress);
      const optionBalanceBefore = await ethPut.balanceOf(buyerAddress);
      const payout = await controller.getPayout(
        ethPut.address,
        shortOptionAmount
      );

      await gammaOperator
        .connect(buyer)
        .redeem(buyerAddress, ethPut.address, shortOptionAmount, 0);

      const usdcBalanceAfter = await usdc.balanceOf(buyerAddress);
      const optionBalanceAfter = await ethPut.balanceOf(buyerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(payout);

      expect(optionBalanceBefore).to.be.gt(0);
      expect(optionBalanceAfter).to.be.eq(0);
    });
    it("should redeem otoken with fee correctly", async () => {
      let fee = 50;
      let strikePrice = 200;
      let collateralAmount = parseUnits("1000", usdcDecimals);
      let shortOptionAmount = parseUnits("1", optionDecimals);
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 19);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          shortOptionAmount
        ),
      ];
      await controller.connect(seller).operate(actionArgs);
      await ethPut.connect(seller).transfer(buyerAddress, shortOptionAmount);
      await ethPut
        .connect(buyer)
        .approve(gammaOperator.address, shortOptionAmount);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );

      const usdcBalanceBefore = await usdc.balanceOf(buyerAddress);
      const optionBalanceBefore = await ethPut.balanceOf(buyerAddress);
      const payout = await controller.getPayout(
        ethPut.address,
        shortOptionAmount
      );
      const payoutMinusFee = payout.sub(payout.mul(fee).div(10000));

      await gammaOperator
        .connect(buyer)
        .redeem(buyerAddress, ethPut.address, shortOptionAmount, fee);

      const usdcBalanceAfter = await usdc.balanceOf(buyerAddress);
      const optionBalanceAfter = await ethPut.balanceOf(buyerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(payoutMinusFee);

      expect(optionBalanceBefore).to.be.gt(0);
      expect(optionBalanceAfter).to.be.eq(0);
    });
  });

  describe("settleVault()", async () => {
    it("should settle vault correctly", async () => {
      let strikePrice = 200;
      let collateralAmount = parseUnits("1000", usdcDecimals);
      let shortOptionAmount = parseUnits("1", optionDecimals);
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 21);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          shortOptionAmount
        ),
      ];
      await controller.connect(seller).operate(actionArgs);
      await setOperator(seller, controller, gammaOperator.address, true);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );

      const usdcBalanceBefore = await usdc.balanceOf(sellerAddress);
      const proceed = await controller.getProceed(sellerAddress, vaultId);

      await gammaOperator.connect(buyer).settle(sellerAddress, vaultId, 0);

      const usdcBalanceAfter = await usdc.balanceOf(sellerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(proceed);
    });
    it("should settle vault with fee correctly", async () => {
      let fee = 10;
      let strikePrice = 200;
      let collateralAmount = parseUnits("1000", usdcDecimals);
      let shortOptionAmount = parseUnits("1", optionDecimals);
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 21);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          shortOptionAmount
        ),
      ];
      await controller.connect(seller).operate(actionArgs);
      await setOperator(seller, controller, gammaOperator.address, true);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );

      const usdcBalanceBefore = await usdc.balanceOf(sellerAddress);
      const proceed = await controller.getProceed(sellerAddress, vaultId);
      const proceedMinusFee = proceed.sub(proceed.mul(fee).div(10000));

      await gammaOperator.connect(buyer).settle(sellerAddress, vaultId, fee);

      const usdcBalanceAfter = await usdc.balanceOf(sellerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(proceedMinusFee);
    });
  });

  describe("shouldRedeemOtoken()", async () => {
    let ethPut: Otoken;
    let expiry: number;
    let strikePrice = 200;
    let strikePriceITM = 150;
    let strikePriceOTM = 250;

    const collateralAmount = parseUnits("1000", usdcDecimals);
    const shortOptionAmount = parseUnits("1", optionDecimals);

    before(async () => {
      const now = (await time.latest()).toNumber();
      expiry = createValidExpiry(now, 14);

      ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ZERO_ADDR,
          vaultId: vaultId.toString(),
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: usdc.address,
          vaultId: vaultId.toString(),
          amount: collateralAmount,
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ethPut.address,
          vaultId: vaultId.toString(),
          amount: shortOptionAmount,
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(seller).operate(actionArgs);
    });

    it("should return false if otoken has not expired", async () => {
      const now = (await time.latest()).toNumber();
      expect(now).to.be.lt(expiry);
      expect(
        await gammaOperator.shouldRedeemOtoken(sellerAddress, ethPut.address, 1)
      ).to.be.eq(false);
    });

    describe("after expiry", () => {
      before(async () => {
        await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
        await ethers.provider.send("evm_mine", []);
      });

      it("should return false if prices are not settled yet", async () => {
        expect(
          await gammaOperator.shouldRedeemOtoken(
            sellerAddress,
            ethPut.address,
            1
          )
        ).to.be.eq(false);
      });
      it("should return false if allowance is 0", async () => {
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          weth.address,
          expiry,
          parseUnits(strikePriceITM.toString(), strikePriceDecimals),
          true
        );
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          usdc.address,
          expiry,
          parseUnits("1", strikePriceDecimals),
          true
        );
        expect(
          await gammaOperator.shouldRedeemOtoken(
            sellerAddress,
            ethPut.address,
            1
          )
        ).to.be.eq(false);
      });
      it("should return false if payout is zero", async () => {
        await ethPut
          .connect(seller)
          .approve(gammaOperator.address, shortOptionAmount);
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          weth.address,
          expiry,
          parseUnits(strikePriceOTM.toString(), strikePriceDecimals),
          true
        );
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          usdc.address,
          expiry,
          parseUnits("1", strikePriceDecimals),
          true
        );

        expect(
          await gammaOperator.shouldRedeemOtoken(
            sellerAddress,
            ethPut.address,
            1
          )
        ).to.be.eq(false);
      });
      it("should return true if payout is greater than zero", async () => {
        await ethPut
          .connect(seller)
          .approve(gammaOperator.address, shortOptionAmount);
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          weth.address,
          expiry,
          parseUnits(strikePriceITM.toString(), strikePriceDecimals),
          true
        );
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          usdc.address,
          expiry,
          parseUnits("1", strikePriceDecimals),
          true
        );

        expect(
          await gammaOperator.shouldRedeemOtoken(
            sellerAddress,
            ethPut.address,
            shortOptionAmount
          )
        ).to.be.eq(true);
      });
    });
  });

  describe("shouldSettleVault()", async () => {
    const collateralAmount = parseUnits("1000", usdcDecimals);
    let strikePrice = 100;
    // TODO: add more cases

    it("should return false if vault is not valid", async () => {
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      expect(
        await gammaOperator.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
    });
    it("should return false if vault has no excess collateral", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 24);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      await setOperator(seller, controller, gammaOperator.address, true);
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actions = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          parseUnits("10", optionDecimals)
        ),
      ];
      await controller.connect(seller).operate(actions);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        1,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );
      expect(
        await gammaOperator.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
    });
    it("should return true if vault can be settled", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 21);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      await setOperator(seller, controller, gammaOperator.address, true);
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actions = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          parseUnits("1", optionDecimals)
        ),
      ];
      await controller.connect(seller).operate(actions);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits((strikePrice + 10).toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );
      expect(
        await gammaOperator.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(true);
    });
  });

  describe("getRedeemPayout()", async () => {
    it("should return the same value as gamma controller", async () => {
      const strikePrice = parseUnits("175", strikePriceDecimals);
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 1);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits("200", strikePriceDecimals),
        expiry,
        true
      );

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        strikePrice,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      const payoutOperator = await gammaOperator.getRedeemPayout(
        ethPut.address,
        parseUnits("100", optionDecimals)
      );
      const payoutGamma = await controller.getPayout(
        ethPut.address,
        parseUnits("100", optionDecimals)
      );
      expect(payoutOperator).to.be.eq(payoutGamma);
    });
  });

  describe("getRedeemableAmount()", async () => {
    it("should return the smallest value", async () => {
      const now = (await time.latest()).toNumber();
      const expiry = createValidExpiry(now, 1);

      const ethPut = await createOtoken(
        otokenFactory,
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits("1000", strikePriceDecimals),
        expiry,
        true
      );

      const collateralAmount = parseUnits("1000", usdcDecimals);
      const shortOptionAmount = parseUnits("1", optionDecimals);

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ZERO_ADDR,
          vaultId: vaultId.toString(),
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: usdc.address,
          vaultId: vaultId.toString(),
          amount: collateralAmount,
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ethPut.address,
          vaultId: vaultId.toString(),
          amount: shortOptionAmount,
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(seller).operate(actionArgs);

      await ethPut.connect(seller).approve(gammaOperator.address, 0);
      expect(
        await gammaOperator.getRedeemableAmount(
          sellerAddress,
          ethPut.address,
          10
        )
      ).to.be.eq(0);

      await ethPut.connect(seller).approve(gammaOperator.address, 10);
      expect(
        await gammaOperator.getRedeemableAmount(
          sellerAddress,
          ethPut.address,
          100
        )
      ).to.be.eq(10);

      await ethPut
        .connect(seller)
        .approve(gammaOperator.address, shortOptionAmount);
      expect(
        await gammaOperator.getRedeemableAmount(
          sellerAddress,
          ethPut.address,
          100
        )
      ).to.be.eq(100);

      await ethPut
        .connect(seller)
        .approve(gammaOperator.address, shortOptionAmount.mul(2));
      expect(
        await gammaOperator.getRedeemableAmount(
          sellerAddress,
          ethPut.address,
          shortOptionAmount.mul(2)
        )
      ).to.be.eq(shortOptionAmount);
    });
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

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ZERO_ADDR,
          vaultId: vaultId.toString(),
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: usdc.address,
          vaultId: vaultId.toString(),
          amount: collateralAmount,
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ethPut.address,
          vaultId: vaultId.toString(),
          amount: shortOptionAmount,
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(seller).operate(actionArgs);

      const [vaultGamma, vaultTypeGamma, timestampGamma] =
        await controller.getVaultWithDetails(sellerAddress, vaultId.toString());
      const [vaultOperator, vaultTypeOperator, timestampOperator] =
        await gammaOperator.getVaultWithDetails(
          sellerAddress,
          vaultId.toString()
        );
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
        parseUnits("50", strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
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
      const vaultId = (
        await controller.getAccountVaultCounter(buyerAddress)
      ).add(1);
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: buyerAddress,
          secondAddress: buyerAddress,
          asset: ZERO_ADDR,
          vaultId: vaultId.toString(),
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
      ];
      await controller.connect(buyer).operate(actionArgs);
      expect(await gammaOperator.isValidVaultId(buyerAddress, 1)).to.be.true;
    });
  });

  describe("setAddressBook()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaOperator.connect(buyer).setAddressBook(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if new address is zero", async () => {
      await expectRevert(
        gammaOperator.connect(deployer).setAddressBook(ZERO_ADDR),
        "GammaOperator::setAddressBook: Address must not be zero"
      );
    });
    it("should set new addressBook", async () => {
      const oldAddressBook = await gammaOperator.addressBook();
      const newAddressBook = buyerAddress;
      expect(oldAddressBook).to.not.be.eq(newAddressBook);
      await gammaOperator.connect(deployer).setAddressBook(newAddressBook);
      expect(await gammaOperator.addressBook()).to.be.eq(newAddressBook);
    });
  });

  describe("refreshConfig()", async () => {
    it("should refresh config", async () => {
      await gammaOperator.connect(deployer).setAddressBook(addressBook.address);
      const oldController = await gammaOperator.controller();
      const oldWhitelist = await gammaOperator.whitelist();
      const oldCalculator = await gammaOperator.calculator();

      const [newAddressBook, , newWhitelist, , , newCalculator, newController] =
        await setupGammaContracts(deployer);
      expect(oldController).to.not.be.eq(newController.address);
      expect(oldWhitelist).to.not.be.eq(newWhitelist.address);
      expect(oldCalculator).to.not.be.eq(newCalculator.address);

      await gammaOperator
        .connect(deployer)
        .setAddressBook(newAddressBook.address);
      await gammaOperator.refreshConfig();

      expect(await gammaOperator.controller()).to.be.eq(newController.address);
      expect(await gammaOperator.whitelist()).to.be.eq(newWhitelist.address);
      expect(await gammaOperator.calculator()).to.be.eq(newCalculator.address);
    });
  });

  describe("harvest()", async () => {
    const amount = parseUnits("1000", usdcDecimals);
    before(async () => {
      await usdc.mint(gammaOperator.address, amount);
    });
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaOperator
          .connect(buyer)
          .harvest(usdc.address, amount, buyerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if amount is wrong", async () => {
      await expectRevert(
        gammaOperator
          .connect(deployer)
          .harvest(usdc.address, amount.mul(2), buyerAddress),
        "ERC20: transfer amount exceeds balance"
      );
    });
    it("should revert if token is wrong", async () => {
      await expectRevert.unspecified(
        gammaOperator.connect(deployer).harvest(ZERO_ADDR, amount, buyerAddress)
      );
    });
    it("should harvest token", async () => {
      const balanceBefore = await usdc.balanceOf(buyerAddress);
      await gammaOperator
        .connect(deployer)
        .harvest(usdc.address, amount, buyerAddress);
      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter.sub(balanceBefore)).to.be.eq(amount);
    });
    it("should harvest token", async () => {
      await deployer.sendTransaction({
        to: gammaOperator.address,
        value: parseEther("1"),
      });
      const balanceBefore = await ethers.provider.getBalance(
        gammaOperator.address
      );
      await gammaOperator
        .connect(deployer)
        .harvest(ETH_TOKEN_ADDRESS, parseEther("1"), buyerAddress);
      const balanceAfter = await ethers.provider.getBalance(
        gammaOperator.address
      );
      expect(balanceBefore.sub(balanceAfter)).to.be.eq(parseEther("1"));
    });
  });
});
