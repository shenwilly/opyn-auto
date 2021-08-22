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
  AutoGamma,
  AutoGammaResolver,
  TaskTreasury,
  Oracle,
  PokeMe,
  Swapper__factory,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import { BigNumber } from "@ethersproject/bignumber";
import { constants, Contract } from "ethers";
import { createValidExpiry } from "../helpers/utils/time";
import {
  ETH_TOKEN_ADDRESS,
  UNISWAP_V2_ROUTER_02,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/address";
import { setupGelatoContracts } from "../helpers/setup/GelatoSetup";
import { setupAutoGammaContracts } from "../helpers/setup/AutoGammaSetup";
import {
  OTOKEN_DECIMALS,
  STRIKE_PRICE_DECIMALS,
  USDC_DECIMALS,
} from "../../constants/decimals";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setExpiryPriceAndEndDisputePeriod,
  whitelistCollateral,
  whitelistProduct,
  getOrCreateOtoken,
} from "../helpers/utils/GammaUtils";
import { mintUsdc } from "../helpers/utils/token";
import { setUniPair } from "../helpers/utils/AutoGammaUtils";
const { time, expectRevert } = require("@openzeppelin/test-helpers");

const { expect } = chai;
const ZERO_ADDR = constants.AddressZero;

describe("AutoGamma", () => {
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
  let oracle: Oracle;
  let controller: Controller;
  let autoGamma: AutoGamma;
  let resolver: AutoGammaResolver;
  let automator: PokeMe;
  let automatorTreasury: TaskTreasury;
  let uniRouter: Contract;

  let usdc: Contract;
  let ethPut: Otoken;

  const strikePrice = 300;
  const expiryPriceITM = 200;
  const expiryPriceOTM = 400;
  const optionsAmount = 10;
  const collateralAmount = optionsAmount * strikePrice;
  const optionAmount = 1;

  let vaultId: BigNumber;
  let expiry: number;
  let snapshotId: string;

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
    ] = await setupGammaContracts();

    [automator, automatorTreasury] = await setupGelatoContracts();
    [autoGamma, resolver] = await setupAutoGammaContracts(
      deployer,
      UNISWAP_V2_ROUTER_02,
      automator.address,
      automatorTreasury.address
    );

    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    uniRouter = await ethers.getContractAt(
      "IUniswapRouter",
      UNISWAP_V2_ROUTER_02
    );

    await whitelistCollateral(whitelist, USDC_ADDRESS);
    await whitelistCollateral(whitelist, WETH_ADDRESS);
    await whitelistProduct(
      whitelist,
      WETH_ADDRESS,
      USDC_ADDRESS,
      USDC_ADDRESS,
      true
    );
    await whitelistProduct(
      whitelist,
      WETH_ADDRESS,
      USDC_ADDRESS,
      WETH_ADDRESS,
      false
    );

    const now = (await time.latest()).toNumber();
    expiry = createValidExpiry(now, 7);

    ethPut = await getOrCreateOtoken(
      otokenFactory,
      WETH_ADDRESS,
      USDC_ADDRESS,
      USDC_ADDRESS,
      parseUnits(strikePrice.toString(), STRIKE_PRICE_DECIMALS),
      expiry,
      true
    );

    // mint usdc to user
    const initialAmountUsdc = parseUnits(
      collateralAmount.toString(),
      USDC_DECIMALS
    ).mul(2);
    await mintUsdc(initialAmountUsdc, sellerAddress);
    await usdc.connect(seller).approve(marginPool.address, initialAmountUsdc);

    vaultId = (await controller.getAccountVaultCounter(sellerAddress)).add(1);
    const actions = [
      getActionOpenVault(sellerAddress, vaultId.toString()),
      getActionDepositCollateral(
        sellerAddress,
        vaultId.toString(),
        USDC_ADDRESS,
        parseUnits(collateralAmount.toString(), USDC_DECIMALS)
      ),
      getActionMintShort(
        sellerAddress,
        vaultId.toString(),
        ethPut.address,
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      ),
    ];
    await controller.connect(seller).operate(actions);
    await ethPut
      .connect(seller)
      .transfer(
        buyerAddress,
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );

    await ethPut
      .connect(buyer)
      .approve(
        autoGamma.address,
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );
    await controller.connect(seller).setOperator(autoGamma.address, true);
    await autoGamma.connect(deployer).startAutomator(resolver.address);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  describe("createOrder()", async () => {
    it("should revert if otoken is not whitelisted", async () => {
      await expectRevert(
        autoGamma
          .connect(buyer)
          .createOrder(
            buyerAddress,
            parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
            0,
            ZERO_ADDR
          ),
        "AutoGamma::createOrder: Otoken not whitelisted"
      );
    });
    it("should revert if otoken amount is 0 and otoken is address(0)", async () => {
      await expectRevert(
        autoGamma.connect(buyer).createOrder(ZERO_ADDR, 1, 1, ZERO_ADDR),
        "AutoGamma::createOrder: Amount must be 0 when creating settlement order"
      );
    });
    it("should revert if settlement token pair is same", async () => {
      const collateralToken = await ethPut.collateralAsset();
      await expectRevert(
        autoGamma
          .connect(buyer)
          .createOrder(
            ethPut.address,
            parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
            0,
            collateralToken
          ),
        "AutoGamma::createOrder: same settlement token and collateral"
      );
    });
    it("should revert if settlement token pair is not allowed", async () => {
      const collateral = await ethPut.collateralAsset();
      expect(collateral).to.be.not.eq(WETH_ADDRESS);
      expect(await autoGamma.uniPair(collateral, WETH_ADDRESS)).to.be.eq(false);
      await expectRevert(
        autoGamma
          .connect(buyer)
          .createOrder(
            ethPut.address,
            parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
            0,
            WETH_ADDRESS
          ),
        "AutoGamma::createOrder: settlement token not allowed"
      );
    });
    it("should create buyer order", async () => {
      const orderId = await autoGamma.getOrdersLength();
      const tx = await autoGamma
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
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
        orderToToken,
        orderFee,
        orderFinished,
      ] = await autoGamma.orders(orderId);
      expect(orderOwner).to.be.eq(buyerAddress);
      expect(orderOtoken).to.be.eq(ethPut.address);
      expect(orderAmount).to.be.eq(
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );
      // expect(orderVaultId).to.be.eq(0);
      expect(orderIsSeller).to.be.eq(false);
      expect(orderToToken).to.be.eq(ZERO_ADDR);
      expect(await autoGamma.redeemFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
    it("should create buyer order (with toToken)", async () => {
      const collateral = await ethPut.collateralAsset();
      await autoGamma.allowPair(collateral, WETH_ADDRESS);
      const orderId = await autoGamma.getOrdersLength();
      const tx = await autoGamma
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          WETH_ADDRESS
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
        orderToToken,
        orderFee,
        orderFinished,
      ] = await autoGamma.orders(orderId);
      expect(orderOwner).to.be.eq(buyerAddress);
      expect(orderOtoken).to.be.eq(ethPut.address);
      expect(orderAmount).to.be.eq(
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );
      // expect(orderVaultId).to.be.eq(0);
      expect(orderIsSeller).to.be.eq(false);
      expect(orderToToken).to.be.eq(WETH_ADDRESS);
      expect(await autoGamma.redeemFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
    it("should create seller order", async () => {
      const orderId = await autoGamma.getOrdersLength();
      const tx = await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);
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
        orderToToken,
        orderFee,
        orderFinished,
      ] = await autoGamma.orders(orderId);
      expect(orderOwner).to.be.eq(sellerAddress);
      expect(orderOtoken).to.be.eq(ZERO_ADDR);
      expect(orderAmount).to.be.eq(0);
      expect(orderVaultId).to.be.eq(vaultId);
      expect(orderIsSeller).to.be.eq(true);
      expect(orderToToken).to.be.eq(ZERO_ADDR);
      expect(await autoGamma.settleFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
    it("should create seller order (with toToken)", async () => {
      const collateral = await ethPut.collateralAsset();
      await autoGamma.allowPair(collateral, WETH_ADDRESS);
      const orderId = await autoGamma.getOrdersLength();
      const tx = await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, WETH_ADDRESS);
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
        orderToToken,
        orderFee,
        orderFinished,
      ] = await autoGamma.orders(orderId);
      expect(orderOwner).to.be.eq(sellerAddress);
      expect(orderOtoken).to.be.eq(ZERO_ADDR);
      expect(orderAmount).to.be.eq(0);
      expect(orderVaultId).to.be.eq(vaultId);
      expect(orderIsSeller).to.be.eq(true);
      expect(orderToToken).to.be.eq(WETH_ADDRESS);
      expect(await autoGamma.settleFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
  });

  describe("cancelOrder()", async () => {
    let orderId: BigNumber;

    beforeEach(async () => {
      orderId = await autoGamma.getOrdersLength();
      await autoGamma.connect(seller).createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);
    });

    it("should revert if sender is not owner", async () => {
      orderId = await autoGamma.getOrdersLength();
      await autoGamma.connect(seller).createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);

      await expectRevert(
        autoGamma.connect(buyer).cancelOrder(orderId),
        "AutoGamma::cancelOrder: Sender is not order owner"
      );
    });
    it("should revert if order is already finished", async () => {
      await autoGamma.connect(seller).cancelOrder(orderId);

      await expectRevert(
        autoGamma.connect(seller).cancelOrder(orderId),
        "AutoGamma::cancelOrder: Order is already finished"
      );
    });
    it("should cancel order", async () => {
      const newOrderId = await autoGamma.getOrdersLength();
      await autoGamma.connect(seller).createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);

      const tx = await autoGamma.connect(seller).cancelOrder(newOrderId);
      const receipt = await tx.wait();
      const event = receipt.events!.filter(
        (event) => event.event == "OrderFinished"
      )[0];
      expect(event.args![0]).to.be.eq(newOrderId);
      expect(event.args![1]).to.be.eq(true);
    });
  });

  describe("shouldProcessOrder()", async () => {
    const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
    beforeEach(async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(expiryPriceITM.toString(), STRIKE_PRICE_DECIMALS)
      );
    });

    it("should return false if isSeller is false and shouldRedeemOtoken is false", async () => {
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethPut.connect(buyer).approve(autoGamma.address, 0);
      expect(
        await autoGamma.shouldRedeemOtoken(buyerAddress, ethPut.address, amount)
      ).to.be.eq(false);
      expect(await autoGamma.shouldProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if isSeller is true and shouldSettleVault is false", async () => {
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(2); // non existent vau;t

      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ethPut.address, 0, vaultId, ZERO_ADDR);

      expect(
        await autoGamma.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
      expect(await autoGamma.shouldProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return true for buyer", async () => {
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethPut.connect(buyer).approve(autoGamma.address, amount);
      expect(await autoGamma.shouldProcessOrder(orderId)).to.be.eq(true);
    });
    it("should return true for seller", async () => {
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);

      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);

      expect(await autoGamma.shouldProcessOrder(orderId)).to.be.eq(true);
    });
  });

  describe("processOrder()", async () => {
    beforeEach(async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(expiryPriceITM.toString(), STRIKE_PRICE_DECIMALS)
      );
    });

    it("should revert if order is already finished", async () => {
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ethPut.address, 0, 1, ZERO_ADDR);
      await autoGamma.connect(seller).cancelOrder(orderId);

      await expectRevert(
        autoGamma.processOrder(orderId, {
          swapAmountOutMin: 0,
          swapPath: [],
        }),
        "AutoGamma::processOrder: Order should not be processed"
      );
    });
    it("should revert if shouldProcessOrder is false", async () => {
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      await ethPut.connect(buyer).approve(autoGamma.address, 0);
      await expectRevert(
        autoGamma.processOrder(orderId, {
          swapAmountOutMin: 0,
          swapPath: [],
        }),
        "AutoGamma::processOrder: Order should not be processed"
      );
    });
    it("should revert if path swap is invalid", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      await setUniPair(autoGamma, collateral, targetToken, true);
      await autoGamma.setRedeemFee(0);

      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, targetToken);

      await ethPut.connect(buyer).approve(autoGamma.address, amount);

      const payout = await controller.getPayout(ethPut.address, amount);
      const path = [collateral, targetToken];
      const amounts = await uniRouter.getAmountsOut(payout, path);

      await expectRevert(
        autoGamma.connect(deployer).processOrder(orderId, {
          swapAmountOutMin: amounts[1],
          swapPath: [targetToken, collateral],
        }),
        "AutoGamma::processOrder: Invalid swap path"
      );
    });
    it("should revert if pair is not allowed", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      await setUniPair(autoGamma, collateral, targetToken, true);
      await autoGamma.setRedeemFee(0);

      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, targetToken);
      await setUniPair(autoGamma, collateral, targetToken, false);

      await ethPut.connect(buyer).approve(autoGamma.address, amount);

      const payout = await controller.getPayout(ethPut.address, amount);
      const path = [collateral, targetToken];
      const amounts = await uniRouter.getAmountsOut(payout, path);

      await expectRevert(
        autoGamma.connect(deployer).processOrder(orderId, {
          swapAmountOutMin: amounts[1],
          swapPath: path,
        }),
        "AutoGamma::processOrder: token pair not allowed"
      );
    });
    it("should redeemOtoken if isSeller is false", async () => {
      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethPut.connect(buyer).approve(autoGamma.address, amount);
      const balanceBefore = await usdc.balanceOf(buyerAddress);
      await autoGamma.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: 0,
        swapPath: [],
      });
      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
    it("should redeemOtoken if isSeller is false (with toToken)", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      const token = await ethers.getContractAt("IERC20", targetToken);
      await setUniPair(autoGamma, collateral, targetToken, true);
      await autoGamma.setRedeemFee(0);

      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, targetToken);

      await ethPut.connect(buyer).approve(autoGamma.address, amount);

      const payout = await controller.getPayout(ethPut.address, amount);
      const path = [collateral, targetToken];
      const amounts = await uniRouter.getAmountsOut(payout, path);

      const balanceBefore = await token.balanceOf(buyerAddress);
      await autoGamma.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: amounts[1],
        swapPath: path,
      });
      const balanceAfter = await token.balanceOf(buyerAddress);
      expect(balanceAfter.sub(balanceBefore)).to.be.eq(amounts[1]);
    });
    it("should settleVault if isSeller is true", async () => {
      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);

      await setOperator(seller, controller, autoGamma.address, true);

      const balanceBefore = await usdc.balanceOf(sellerAddress);
      await autoGamma.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: 0,
        swapPath: [],
      });
      const balanceAfter = await usdc.balanceOf(sellerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
    it("should settleVault if isSeller is true (with toToken)", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      const token = await ethers.getContractAt("IERC20", targetToken);
      await setUniPair(autoGamma, collateral, targetToken, true);
      await autoGamma.setSettleFee(0);

      const orderId = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, targetToken);

      await setOperator(seller, controller, autoGamma.address, true);

      const proceed = await controller.getProceed(sellerAddress, vaultId);
      const path = [collateral, targetToken];
      const amounts = await uniRouter.getAmountsOut(proceed, path);

      const balanceBefore = await token.balanceOf(sellerAddress);
      await autoGamma.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: amounts[1],
        swapPath: path,
      });
      const balanceAfter = await token.balanceOf(sellerAddress);
      expect(balanceAfter.sub(balanceBefore)).to.be.eq(amounts[1]);
    });
  });

  describe("processOrders()", async () => {
    beforeEach(async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(expiryPriceITM.toString(), STRIKE_PRICE_DECIMALS)
      );
    });

    it("should revert if params length not equal", async () => {
      await expectRevert(
        autoGamma.connect(deployer).processOrders([1], []),
        "AutoGamma::processOrders: Params lengths must be same"
      );
    });
    it("should process orders", async () => {
      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId1 = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);
      await ethPut.connect(buyer).approve(autoGamma.address, amount);

      const orderId2 = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);
      await setOperator(seller, controller, autoGamma.address, true);

      const balanceBefore1 = await usdc.balanceOf(buyerAddress);
      const balanceBefore2 = await usdc.balanceOf(sellerAddress);
      await autoGamma.connect(deployer).processOrders(
        [orderId1, orderId2],
        [
          {
            swapAmountOutMin: 0,
            swapPath: [],
          },
          {
            swapAmountOutMin: 0,
            swapPath: [],
          },
        ]
      );
      const balanceAfter1 = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter1).to.be.gt(balanceBefore1);
      const balanceAfter2 = await usdc.balanceOf(sellerAddress);
      expect(balanceAfter2).to.be.gt(balanceBefore2);
    });
  });

  describe("withdrawFunds()", async () => {
    const amount = parseEther("1");
    beforeEach(async () => {
      await automatorTreasury.depositFunds(
        autoGamma.address,
        ETH_TOKEN_ADDRESS,
        0,
        {
          value: amount,
        }
      );
    });

    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).withdrawFund(ETH_TOKEN_ADDRESS, amount),
        "Ownable: caller is not the owner'"
      );
    });
    it("should withdraw funds from treasury", async () => {
      const ethBalanceBefore = await ethers.provider.getBalance(
        autoGamma.address
      );
      await autoGamma.connect(deployer).withdrawFund(ETH_TOKEN_ADDRESS, amount);
      const ethBalanceAfter = await ethers.provider.getBalance(
        autoGamma.address
      );

      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.eq(amount);
    });
  });

  describe("setAutomator()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).setAutomator(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator", async () => {
      const oldAddress = await autoGamma.automator();
      const newAddress = buyerAddress;
      expect(oldAddress).to.not.be.eq(newAddress);
      await autoGamma.connect(deployer).setAutomator(newAddress);
      expect(await autoGamma.automator()).to.be.eq(newAddress);
    });
  });

  describe("setAutomatorTreasury()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).setAutomatorTreasury(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldAddress = await autoGamma.automatorTreasury();
      const newAddress = buyerAddress;
      expect(oldAddress).to.not.be.eq(newAddress);
      await autoGamma.connect(deployer).setAutomatorTreasury(newAddress);
      expect(await autoGamma.automatorTreasury()).to.be.eq(newAddress);
    });
  });

  describe("setRedeemFee()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).setRedeemFee(1),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldFee = await autoGamma.redeemFee();
      const newFee = oldFee.add(1);
      await autoGamma.connect(deployer).setRedeemFee(newFee);
      expect(await autoGamma.redeemFee()).to.be.eq(newFee);
    });
  });

  describe("setSettleFee()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).setSettleFee(1),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldFee = await autoGamma.settleFee();
      const newFee = oldFee.add(1);
      await autoGamma.connect(deployer).setSettleFee(newFee);
      expect(await autoGamma.settleFee()).to.be.eq(newFee);
    });
  });

  describe("setUniRouter()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).setUniRouter(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldRouter = await autoGamma.uniRouter();
      const newRouter = deployerAddress;
      expect(oldRouter).to.be.not.eq(newRouter);
      await autoGamma.connect(deployer).setUniRouter(deployerAddress);
      expect(await autoGamma.uniRouter()).to.be.eq(newRouter);
    });
  });

  describe("allowPair()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).allowPair(USDC_ADDRESS, WETH_ADDRESS),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if pair is already allowed", async () => {
      await autoGamma.connect(deployer).allowPair(USDC_ADDRESS, WETH_ADDRESS);
      await expectRevert(
        autoGamma.connect(deployer).allowPair(USDC_ADDRESS, WETH_ADDRESS),
        "AutoGamma::allowPair: already allowed"
      );
    });
    it("should set pair to true", async () => {
      expect(await autoGamma.uniPair(USDC_ADDRESS, WETH_ADDRESS)).to.be.eq(
        false
      );
      await autoGamma.connect(deployer).allowPair(USDC_ADDRESS, WETH_ADDRESS);
      expect(await autoGamma.uniPair(USDC_ADDRESS, WETH_ADDRESS)).to.be.eq(
        true
      );
      expect(await autoGamma.uniPair(WETH_ADDRESS, USDC_ADDRESS)).to.be.eq(
        true
      );
    });
  });

  describe("disallowPair()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).disallowPair(USDC_ADDRESS, WETH_ADDRESS),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if pair is already disallowed", async () => {
      expect(await autoGamma.uniPair(USDC_ADDRESS, WETH_ADDRESS)).to.be.eq(
        false
      );
      await expectRevert(
        autoGamma.connect(deployer).disallowPair(USDC_ADDRESS, WETH_ADDRESS),
        "AutoGamma::allowPair: already disallowed"
      );
    });
    it("should set pair to true", async () => {
      await autoGamma.connect(deployer).allowPair(USDC_ADDRESS, WETH_ADDRESS);
      expect(await autoGamma.uniPair(USDC_ADDRESS, WETH_ADDRESS)).to.be.eq(
        true
      );
      await autoGamma
        .connect(deployer)
        .disallowPair(USDC_ADDRESS, WETH_ADDRESS);
      expect(await autoGamma.uniPair(USDC_ADDRESS, WETH_ADDRESS)).to.be.eq(
        false
      );
      expect(await autoGamma.uniPair(WETH_ADDRESS, USDC_ADDRESS)).to.be.eq(
        false
      );
    });
  });

  describe("swap()", async () => {
    it("should swap correctly", async () => {
      const SwapperFactory = (await ethers.getContractFactory(
        "Swapper",
        deployer
      )) as Swapper__factory;
      const swapper = await SwapperFactory.deploy(
        addressBook.address,
        UNISWAP_V2_ROUTER_02,
        automator.address,
        automatorTreasury.address
      );
      const uniRouter = await ethers.getContractAt(
        "IUniswapRouter",
        UNISWAP_V2_ROUTER_02
      );
      const weth = await ethers.getContractAt("IERC20", WETH_ADDRESS);
      const amount = parseUnits("10000", USDC_DECIMALS);
      const path = [USDC_ADDRESS, WETH_ADDRESS];

      await mintUsdc(amount, swapper.address);
      const amounts = await uniRouter.getAmountsOut(amount, path);
      const expectedOutputAmount = amounts[1];

      await swapper.approve(USDC_ADDRESS, UNISWAP_V2_ROUTER_02, amount);

      const balanceBefore = await weth.balanceOf(swapper.address);
      await swapper.swapToken(amount, expectedOutputAmount, path);
      const balanceAfter = await weth.balanceOf(swapper.address);

      expect(balanceAfter.sub(balanceBefore)).to.be.eq(expectedOutputAmount);
    });
  });

  describe("startAutomator()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).startAutomator(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if already started", async () => {
      expect(await autoGamma.isAutomatorEnabled()).to.be.eq(true);
      await expectRevert(
        autoGamma.connect(deployer).startAutomator(deployerAddress),
        "AutoGamma::startAutomator: already started"
      );
    });
    it("should start automator", async () => {
      await autoGamma.connect(deployer).stopAutomator();
      expect(await autoGamma.isAutomatorEnabled()).to.be.eq(false);

      await autoGamma.startAutomator(deployerAddress);
      expect(await autoGamma.isAutomatorEnabled()).to.be.eq(true);
    });
  });

  describe("stopAutomator()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        autoGamma.connect(buyer).startAutomator(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if already stopped", async () => {
      await autoGamma.connect(deployer).stopAutomator();
      await expectRevert(
        autoGamma.connect(deployer).stopAutomator(),
        "AutoGamma::stopAutomator: already stopped"
      );
    });
    it("should stop automator", async () => {
      expect(await autoGamma.isAutomatorEnabled()).to.be.eq(true);
      await autoGamma.connect(deployer).stopAutomator();
      expect(await autoGamma.isAutomatorEnabled()).to.be.eq(false);
    });
  });
});
