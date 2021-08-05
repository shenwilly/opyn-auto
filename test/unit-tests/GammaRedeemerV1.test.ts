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
  PokeMe__factory,
  GammaRedeemerResolver__factory,
  GammaRedeemerResolver,
} from "../../typechain";
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setupGammaContracts,
} from "../helpers/setup/GammaSetup";
import { BigNumber } from "@ethersproject/bignumber";
import { constants } from "ethers";
const { time, expectRevert } = require("@openzeppelin/test-helpers");

const { expect } = chai;

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
  let gammaRedeemer: GammaRedeemerV1;
  let resolver: GammaRedeemerResolver;

  let expiry: number;
  let usdc: MockERC20;
  let weth: MockERC20;

  let ethPut: Otoken;

  const strikePrice = 300;
  const expiryPriceITM = 200;
  const expiryPriceOTM = 400;
  const optionsAmount = 10;
  const collateralAmount = optionsAmount * strikePrice;
  const optionAmount = 1;

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

    // deploy Vault Operator
    const PokeMeFactory = (await ethers.getContractFactory(
      "PokeMe",
      deployer
    )) as PokeMe__factory;
    const automator = await PokeMeFactory.deploy(
      deployerAddress,
      deployerAddress
    );

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemerV1",
      deployer
    )) as GammaRedeemerV1__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(
      addressBook.address,
      automator.address
    );

    const ResolverFactory = (await ethers.getContractFactory(
      "GammaRedeemerResolver",
      buyer
    )) as GammaRedeemerResolver__factory;
    resolver = await ResolverFactory.deploy(gammaRedeemer.address);

    const now = (await time.latest()).toNumber();
    expiry = createValidExpiry(now, 7);

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      parseUnits(strikePrice.toString(), strikePriceDecimals),
      expiry,
      true
    );
    const ethPutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      parseUnits(strikePrice.toString(), strikePriceDecimals),
      expiry,
      true
    );

    ethPut = (await ethers.getContractAt("Otoken", ethPutAddress)) as Otoken;

    // mint usdc to user
    const initialAmountUsdc = parseUnits(
      collateralAmount.toString(),
      usdcDecimals
    ).mul(2);
    await usdc.mint(sellerAddress, initialAmountUsdc);
    await usdc.connect(seller).approve(marginPool.address, initialAmountUsdc);

    const vaultId = (
      await controller.getAccountVaultCounter(sellerAddress)
    ).add(1);
    const actions = [
      getActionOpenVault(sellerAddress, vaultId.toString()),
      getActionDepositCollateral(
        sellerAddress,
        vaultId.toString(),
        usdc.address,
        parseUnits(collateralAmount.toString(), usdcDecimals)
      ),
      getActionMintShort(
        sellerAddress,
        vaultId.toString(),
        ethPut.address,
        parseUnits(optionAmount.toString(), optionDecimals)
      ),
    ];
    await controller.connect(seller).operate(actions);
    await ethPut
      .connect(seller)
      .transfer(
        buyerAddress,
        parseUnits(optionAmount.toString(), optionDecimals)
      );

    await ethPut
      .connect(buyer)
      .approve(
        gammaRedeemer.address,
        parseUnits(optionAmount.toString(), optionDecimals)
      );
    await controller.connect(seller).setOperator(gammaRedeemer.address, true);

    await gammaRedeemer.connect(deployer).startAutomator(resolver.address);
  });

  describe("createOrder()", async () => {
    it("should revert if otoken is not whitelisted", async () => {
      await expectRevert(
        gammaRedeemer
          .connect(buyer)
          .createOrder(
            buyerAddress,
            parseUnits(optionAmount.toString(), optionDecimals),
            0
          ),
        "GammaRedeemer::createOrder: Otoken not whitelisted"
      );
    });
    it("should create buyer order", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      const tx = await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );
      const receipt = await tx.wait();
      const event = receipt.events!.filter(
        (event) => event.event == "OrderCreated"
      )[0];
      expect(event.args![0]).to.be.eq(orderId);

      const [
        orderOwner,
        orderOtoken,
        orderAmount,
        orderVaultId,
        orderIsSeller,
        orderToEth,
        orderFinished,
      ] = await gammaRedeemer.orders(orderId);
      expect(orderOwner).to.be.eq(buyerAddress);
      expect(orderOtoken).to.be.eq(ethPut.address);
      expect(orderAmount).to.be.eq(
        parseUnits(optionAmount.toString(), optionDecimals)
      );
      // expect(orderVaultId).to.be.eq(0);
      expect(orderIsSeller).to.be.eq(false);
      expect(orderToEth).to.be.eq(false);
      expect(orderFinished).to.be.eq(false);
    });
    it("should create seller order", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      const tx = await gammaRedeemer
        .connect(seller)
        .createOrder(ethPut.address, 0, 1);
      const receipt = await tx.wait();
      const event = receipt.events!.filter(
        (event) => event.event == "OrderCreated"
      )[0];
      expect(event.args![0]).to.be.eq(orderId);

      const [
        orderOwner,
        orderOtoken,
        orderAmount,
        orderVaultId,
        orderIsSeller,
        orderToEth,
        orderFinished,
      ] = await gammaRedeemer.orders(orderId);
      expect(orderOwner).to.be.eq(sellerAddress);
      // expect(orderOtoken).to.be.eq(ethPut.address);
      expect(orderAmount).to.be.eq(0);
      expect(orderVaultId).to.be.eq(1);
      expect(orderIsSeller).to.be.eq(true);
      expect(orderToEth).to.be.eq(false);
      expect(orderFinished).to.be.eq(false);
    });
  });

  describe("cancelOrder()", async () => {
    let orderId: BigNumber;
    before(async () => {
      orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(constants.AddressZero, 0, 10);
    });
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).cancelOrder(orderId),
        "GammaRedeemer::cancelOrder: Sender is not order owner"
      );
    });
    it("should revert if order is already finished", async () => {
      await gammaRedeemer.connect(seller).cancelOrder(orderId);

      await expectRevert(
        gammaRedeemer.connect(seller).cancelOrder(orderId),
        "GammaRedeemer::cancelOrder: Order is already finished"
      );
    });
    it("should cancel order", async () => {
      const newOrderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(constants.AddressZero, 0, 10);

      const tx = await gammaRedeemer.connect(seller).cancelOrder(newOrderId);
      const receipt = await tx.wait();
      const event = receipt.events!.filter(
        (event) => event.event == "OrderFinished"
      )[0];
      expect(event.args![0]).to.be.eq(newOrderId);
      expect(event.args![1]).to.be.eq(true);
    });
  });

  describe("shouldProcessOrder()", async () => {
    const amount = parseUnits(optionAmount.toString(), optionDecimals);
    before(async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(expiryPriceITM.toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );
    });

    it("should return false if isSeller is false and shouldRedeemOtoken is false", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer.connect(buyer).createOrder(ethPut.address, amount, 0);

      await ethPut.connect(buyer).approve(gammaRedeemer.address, 0);
      expect(
        await gammaRedeemer.shouldRedeemOtoken(
          buyerAddress,
          ethPut.address,
          amount
        )
      ).to.be.eq(false);
      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if isSeller is true and shouldSettleVault is false", async () => {
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(2); // non existent vau;t

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ethPut.address, 0, vaultId);

      expect(
        await gammaRedeemer.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return true for buyer", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer.connect(buyer).createOrder(ethPut.address, amount, 0);

      await ethPut.connect(buyer).approve(gammaRedeemer.address, amount);
      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);
    });
    it("should return true for seller", async () => {
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ethPut.address, 0, vaultId);

      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);
    });
  });

  describe("processOrder()", async () => {
    let ethPut: Otoken;
    before(async () => {
      const now = (await time.latest()).toNumber();
      expiry = createValidExpiry(now, 7);

      await otokenFactory.createOtoken(
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );
      const ethPutAddress = await otokenFactory.getOtoken(
        weth.address,
        usdc.address,
        usdc.address,
        parseUnits(strikePrice.toString(), strikePriceDecimals),
        expiry,
        true
      );

      ethPut = (await ethers.getContractAt("Otoken", ethPutAddress)) as Otoken;
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actions = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          usdc.address,
          parseUnits(collateralAmount.toString(), usdcDecimals)
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals)
        ),
      ];
      await controller.connect(seller).operate(actions);
      await ethPut
        .connect(seller)
        .transfer(
          buyerAddress,
          parseUnits(optionAmount.toString(), optionDecimals)
        );

      await ethPut
        .connect(buyer)
        .approve(
          gammaRedeemer.address,
          parseUnits(optionAmount.toString(), optionDecimals)
        );

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(expiryPriceITM.toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );
    });
    it("should revert if order is already finished", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer.connect(seller).createOrder(ethPut.address, 0, 1);
      await gammaRedeemer.connect(seller).cancelOrder(orderId);

      await expectRevert(
        gammaRedeemer.processOrder(orderId),
        "GammaRedeemer::processOrder: Order is already finished"
      );
    });
    it("should revert if shouldProcessOrder is false", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

      await ethPut.connect(buyer).approve(gammaRedeemer.address, 0);
      await expect(gammaRedeemer.processOrder(orderId)).to.be.reverted;
    });
    it("should redeemOtoken if isSeller is false", async () => {
      const amount = parseUnits(optionAmount.toString(), optionDecimals);
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer.connect(buyer).createOrder(ethPut.address, amount, 0);

      await ethPut.connect(buyer).approve(gammaRedeemer.address, amount);
      const balanceBefore = await usdc.balanceOf(buyerAddress);
      await gammaRedeemer.connect(deployer).processOrder(orderId);
      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
    it("should settleVault if isSeller is true", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer.connect(seller).createOrder(ethPut.address, 0, 1);

      await setOperator(seller, controller, gammaRedeemer.address, true);
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        parseUnits(expiryPriceOTM.toString(), strikePriceDecimals),
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        parseUnits("1", strikePriceDecimals),
        true
      );
      const balanceBefore = await usdc.balanceOf(sellerAddress);
      await gammaRedeemer.connect(deployer).processOrder(orderId);
      const balanceAfter = await usdc.balanceOf(sellerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
});
