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
  GammaRedeemerV1,
  GammaRedeemerResolver,
  TaskTreasury,
  Oracle,
  PokeMe,
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
const { time, expectRevert } = require("@openzeppelin/test-helpers");

const { expect } = chai;
const ZERO_ADDR = constants.AddressZero;

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
  let oracle: Oracle;
  let controller: Controller;
  let gammaRedeemer: GammaRedeemerV1;
  let resolver: GammaRedeemerResolver;
  let automator: PokeMe;
  let automatorTreasury: TaskTreasury;

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
    [gammaRedeemer, resolver] = await setupAutoGammaContracts(
      deployer,
      UNISWAP_V2_ROUTER_02,
      automator.address,
      automatorTreasury.address
    );

    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

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
        gammaRedeemer.address,
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );
    await controller.connect(seller).setOperator(gammaRedeemer.address, true);
    await gammaRedeemer.connect(deployer).startAutomator(resolver.address);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  describe("createOrder()", async () => {
    it("should revert if otoken is not whitelisted", async () => {
      await expectRevert(
        gammaRedeemer
          .connect(buyer)
          .createOrder(
            buyerAddress,
            parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
            0,
            ZERO_ADDR
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
      ] = await gammaRedeemer.orders(orderId);
      expect(orderOwner).to.be.eq(buyerAddress);
      expect(orderOtoken).to.be.eq(ethPut.address);
      expect(orderAmount).to.be.eq(
        parseUnits(optionAmount.toString(), OTOKEN_DECIMALS)
      );
      // expect(orderVaultId).to.be.eq(0);
      expect(orderIsSeller).to.be.eq(false);
      expect(orderToToken).to.be.eq(ZERO_ADDR);
      expect(await gammaRedeemer.redeemFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
    it("should create seller order", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      const tx = await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, 1, ZERO_ADDR);
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
      ] = await gammaRedeemer.orders(orderId);
      expect(orderOwner).to.be.eq(sellerAddress);
      expect(orderOtoken).to.be.eq(ZERO_ADDR);
      expect(orderAmount).to.be.eq(0);
      expect(orderVaultId).to.be.eq(1);
      expect(orderIsSeller).to.be.eq(true);
      expect(orderToToken).to.be.eq(ZERO_ADDR);
      expect(await gammaRedeemer.settleFee()).to.be.eq(orderFee);
      expect(orderFinished).to.be.eq(false);
    });
  });

  describe("cancelOrder()", async () => {
    let orderId: BigNumber;

    beforeEach(async () => {
      orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);
    });

    it("should revert if sender is not owner", async () => {
      orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);

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
        .createOrder(ZERO_ADDR, 0, 10, ZERO_ADDR);

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
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

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
        .createOrder(ethPut.address, 0, vaultId, ZERO_ADDR);

      expect(
        await gammaRedeemer.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return true for buyer", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethPut.connect(buyer).approve(gammaRedeemer.address, amount);
      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);
    });
    it("should return true for seller", async () => {
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);

      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);
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
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ethPut.address, 0, 1, ZERO_ADDR);
      await gammaRedeemer.connect(seller).cancelOrder(orderId);

      await expectRevert(
        gammaRedeemer.processOrder(orderId, {
          swapAmountOutMin: 0,
          swapPath: [],
        }),
        "GammaRedeemer::processOrder: Order should not be processed"
      );
    });
    it("should revert if shouldProcessOrder is false", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      await ethPut.connect(buyer).approve(gammaRedeemer.address, 0);
      await expect(
        gammaRedeemer.processOrder(orderId, {
          swapAmountOutMin: 0,
          swapPath: [],
        })
      ).to.be.reverted;
    });
    it("should redeemOtoken if isSeller is false", async () => {
      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethPut.connect(buyer).approve(gammaRedeemer.address, amount);
      const balanceBefore = await usdc.balanceOf(buyerAddress);
      await gammaRedeemer.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: 0,
        swapPath: [],
      });
      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
    it("should settleVault if isSeller is true", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);

      await setOperator(seller, controller, gammaRedeemer.address, true);

      const balanceBefore = await usdc.balanceOf(sellerAddress);
      await gammaRedeemer.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: 0,
        swapPath: [],
      });
      const balanceAfter = await usdc.balanceOf(sellerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("withdrawFunds()", async () => {
    const amount = parseEther("1");
    beforeEach(async () => {
      await automatorTreasury.depositFunds(
        gammaRedeemer.address,
        ETH_TOKEN_ADDRESS,
        0,
        {
          value: amount,
        }
      );
    });

    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).withdrawFund(ETH_TOKEN_ADDRESS, amount),
        "Ownable: caller is not the owner'"
      );
    });
    it("should withdraw funds from treasury", async () => {
      const ethBalanceBefore = await ethers.provider.getBalance(
        gammaRedeemer.address
      );
      await gammaRedeemer
        .connect(deployer)
        .withdrawFund(ETH_TOKEN_ADDRESS, amount);
      const ethBalanceAfter = await ethers.provider.getBalance(
        gammaRedeemer.address
      );

      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.eq(amount);
    });
  });

  describe("setAutomator()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).setAutomator(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator", async () => {
      const oldAddress = await gammaRedeemer.automator();
      const newAddress = buyerAddress;
      expect(oldAddress).to.not.be.eq(newAddress);
      await gammaRedeemer.connect(deployer).setAutomator(newAddress);
      expect(await gammaRedeemer.automator()).to.be.eq(newAddress);
    });
  });

  describe("setAutomatorTreasury()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).setAutomatorTreasury(deployerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldAddress = await gammaRedeemer.automatorTreasury();
      const newAddress = buyerAddress;
      expect(oldAddress).to.not.be.eq(newAddress);
      await gammaRedeemer.connect(deployer).setAutomatorTreasury(newAddress);
      expect(await gammaRedeemer.automatorTreasury()).to.be.eq(newAddress);
    });
  });

  describe("setRedeemFee()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).setRedeemFee(1),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldFee = await gammaRedeemer.redeemFee();
      const newFee = oldFee.add(1);
      await gammaRedeemer.connect(deployer).setRedeemFee(newFee);
      expect(await gammaRedeemer.redeemFee()).to.be.eq(newFee);
    });
  });

  describe("setSettleFee()", async () => {
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaRedeemer.connect(buyer).setSettleFee(1),
        "Ownable: caller is not the owner'"
      );
    });
    it("should set new automator treasury", async () => {
      const oldFee = await gammaRedeemer.settleFee();
      const newFee = oldFee.add(1);
      await gammaRedeemer.connect(deployer).setSettleFee(newFee);
      expect(await gammaRedeemer.settleFee()).to.be.eq(newFee);
    });
  });
});
