import hre, { ethers } from "hardhat";
import chai from "chai";
import {
  Controller,
  Otoken,
  MarginPool,
  AutoGamma,
  AutoGammaResolver,
  PokeMe,
  TaskTreasury,
  Oracle,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import {
  ETH_TOKEN_ADDRESS,
  UNISWAP_V2_ROUTER_02,
  USDC_ADDRESS,
  USDC_WALLET,
  WETH_ADDRESS,
  ZERO_ADDR,
} from "../../constants/address";
import {
  OTOKEN_DECIMALS,
  STRIKE_PRICE_DECIMALS,
  USDC_DECIMALS,
} from "../../constants/decimals";

import { BigNumber, Contract } from "ethers/lib/ethers";
import { setupGelatoContracts } from "../helpers/setup/GelatoSetup";
import { setupAutoGammaContracts } from "../helpers/setup/AutoGammaSetup";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setExpiryPriceAndEndDisputePeriod,
} from "../helpers/utils/GammaUtils";

const { expect } = chai;

// oWETHUSDC/USDC-20AUG21-2300P
const OTOKEN_ADDRESS = "0xd585cce0bfaedae7797babe599c38d7c157e1e43";
const WBTC_ADDRESS = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";

describe("Scenario: Auto Redeem", () => {
  let deployer: SignerWithAddress;

  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyerAddress: string;
  let sellerAddress: string;

  let controller: Controller;
  let marginPool: MarginPool;
  let oracle: Oracle;
  let autoGamma: AutoGamma;
  let resolver: AutoGammaResolver;
  let automator: PokeMe;
  let automatorTreasury: TaskTreasury;
  let uniRouter: Contract;

  let usdc: Contract;
  let ethPut: Otoken;
  let collateral: string;
  let toTokenAddress: string;
  let toToken: Contract;

  const strikePrice = "2000";
  let expiry: number;

  before("setup contracts", async () => {
    [deployer, buyer, seller] = await ethers.getSigners();
    buyerAddress = buyer.address;
    sellerAddress = seller.address;

    [, , , oracle, marginPool, , controller] = await setupGammaContracts();
    [automator, automatorTreasury] = await setupGelatoContracts();
    [autoGamma, resolver] = await setupAutoGammaContracts(
      deployer,
      UNISWAP_V2_ROUTER_02,
      automator.address,
      automatorTreasury.address
    );
    uniRouter = await ethers.getContractAt(
      "IUniswapRouter",
      UNISWAP_V2_ROUTER_02
    );
    ethPut = (await ethers.getContractAt("Otoken", OTOKEN_ADDRESS)) as Otoken;
    collateral = await ethPut.collateralAsset();
    toTokenAddress = WBTC_ADDRESS;
    await autoGamma.connect(deployer).allowPair(collateral, toTokenAddress);

    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    toToken = await ethers.getContractAt("IERC20", toTokenAddress);

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDC_WALLET],
    });

    const usdcAmount = parseUnits(
      (parseInt(strikePrice) * 2).toString(),
      USDC_DECIMALS
    ).mul(2);

    const usdcWalletSigner = await ethers.getSigner(USDC_WALLET);
    await usdc.connect(usdcWalletSigner).transfer(sellerAddress, usdcAmount);
    await usdc.connect(seller).approve(marginPool.address, usdcAmount);

    const vaultId = (
      await controller.getAccountVaultCounter(sellerAddress)
    ).add(1);
    const actions = [
      getActionOpenVault(sellerAddress, vaultId.toString()),
      getActionDepositCollateral(
        sellerAddress,
        vaultId.toString(),
        usdc.address,
        usdcAmount
      ),
      getActionMintShort(
        sellerAddress,
        vaultId.toString(),
        ethPut.address,
        parseUnits("2", OTOKEN_DECIMALS)
      ),
    ];
    await controller.connect(seller).operate(actions);

    await ethPut
      .connect(seller)
      .transfer(buyerAddress, parseUnits("2", OTOKEN_DECIMALS));
    await ethPut
      .connect(buyer)
      .approve(autoGamma.address, parseUnits("2", OTOKEN_DECIMALS));
    await setOperator(seller, controller, autoGamma.address, true);
    await autoGamma.startAutomator(resolver.address);
    await automatorTreasury
      .connect(deployer)
      .depositFunds(autoGamma.address, ETH_TOKEN_ADDRESS, 0, {
        value: parseEther("0.1"),
      });
  });

  describe("auto redeem", async () => {
    let buyerOrderId1: BigNumber;
    let buyerOrderId2: BigNumber;
    let sellerOrderId: BigNumber;
    let vaultId: BigNumber;

    let buyerOrderIdAmount = parseUnits("1", OTOKEN_DECIMALS);
    let buyerOrderId2Amount = parseUnits("1", OTOKEN_DECIMALS);

    before(async () => {
      expiry = (await ethPut.expiryTimestamp()).toNumber();
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(strikePrice, STRIKE_PRICE_DECIMALS)
      );

      buyerOrderId1 = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, buyerOrderIdAmount, 0, toTokenAddress);
      buyerOrderId2 = await autoGamma.getOrdersLength();
      await autoGamma
        .connect(buyer)
        .createOrder(ethPut.address, buyerOrderId2Amount, 0, toTokenAddress);

      sellerOrderId = await autoGamma.getOrdersLength();
      vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await autoGamma
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, toTokenAddress);
    });

    it("should redeem otoken & settle vault", async () => {
      const path = [collateral, toTokenAddress];
      const buyerPayout = await controller.getPayout(
        ethPut.address,
        parseUnits("2", OTOKEN_DECIMALS)
      );
      const sellerProceed = await controller.getProceed(sellerAddress, vaultId);

      const contractBalanceBefore = await usdc.balanceOf(autoGamma.address);
      const buyerBalanceBefore = await toToken.balanceOf(buyerAddress);
      const sellerBalanceBefore = await toToken.balanceOf(sellerAddress);

      expect(await autoGamma.shouldProcessOrder(buyerOrderId1)).to.be.eq(true);
      expect(await autoGamma.shouldProcessOrder(sellerOrderId)).to.be.eq(true);

      const maxSlippage = await resolver.maxSlippage();

      let buyerOrderId1Payout = await controller.getPayout(
        ethPut.address,
        buyerOrderIdAmount
      );
      const [, , , , , , buyerOrder1Fee, ,] = await autoGamma.orders(
        buyerOrderId1
      );
      const buyerOrder1FeeTotal = buyerOrder1Fee
        .mul(buyerOrderId1Payout)
        .div(10000);
      buyerOrderId1Payout = buyerOrderId1Payout.sub(buyerOrder1FeeTotal);
      const buyerOrder1Amounts = await uniRouter.getAmountsOut(
        buyerOrderId1Payout,
        path
      );
      let buyerOrder1AmountOutMin = buyerOrder1Amounts[1];
      buyerOrder1AmountOutMin = buyerOrder1AmountOutMin.sub(
        buyerOrder1AmountOutMin.mul(maxSlippage).div(10000)
      );

      let sellerOrderPayout = await controller.getProceed(
        sellerAddress,
        vaultId
      );
      const [, , , , , , sellerOrderFee, ,] = await autoGamma.orders(
        sellerOrderId
      );
      const sellerOrderFeeTotal = sellerOrderFee
        .mul(sellerOrderPayout)
        .div(10000);
      sellerOrderPayout = sellerOrderPayout.sub(sellerOrderFeeTotal);
      let sellerOrderAmounts = await uniRouter.getAmountsOut(
        sellerOrderPayout,
        path
      );
      let sellerOrderAmountOutMin = sellerOrderAmounts[1];
      sellerOrderAmountOutMin = sellerOrderAmountOutMin.sub(
        sellerOrderAmountOutMin.mul(maxSlippage).div(10000)
      );

      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(true);
      const taskData = autoGamma.interface.encodeFunctionData("processOrders", [
        [buyerOrderId1, sellerOrderId],
        [
          {
            swapAmountOutMin: buyerOrder1AmountOutMin,
            swapPath: path,
          },
          {
            swapAmountOutMin: sellerOrderAmountOutMin,
            swapPath: path,
          },
        ],
      ]);
      expect(execPayload).to.be.eq(taskData);

      const gelato = await automator.gelato();
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [gelato],
      });
      const gelatoSigner = await ethers.getSigner(gelato);
      await automator
        .connect(gelatoSigner)
        .exec(
          parseEther("0.02"),
          ETH_TOKEN_ADDRESS,
          autoGamma.address,
          autoGamma.address,
          taskData
        );

      let buyerOrderId2Payout = await controller.getPayout(
        ethPut.address,
        buyerOrderId2Amount
      );
      const [, , , , , , buyerOrder2Fee, ,] = await autoGamma.orders(
        buyerOrderId2
      );
      const buyerOrder2FeeTotal = buyerOrder2Fee
        .mul(buyerOrderId2Payout)
        .div(10000);
      buyerOrderId2Payout = buyerOrderId2Payout.sub(buyerOrder2FeeTotal);
      const buyerOrder2Amounts = await uniRouter.getAmountsOut(
        buyerOrderId2Payout,
        path
      );
      let buyerOrder2AmountOutMin = buyerOrder2Amounts[1];
      buyerOrder2AmountOutMin = buyerOrder2AmountOutMin.sub(
        buyerOrder2AmountOutMin.mul(maxSlippage).div(10000)
      );

      const [canExecSecond, execPayloadSecond] =
        await resolver.getProcessableOrders();
      expect(canExecSecond).to.be.eq(true);
      const taskDataSecond = autoGamma.interface.encodeFunctionData(
        "processOrders",
        [
          [buyerOrderId2],
          [
            {
              swapAmountOutMin: buyerOrder2AmountOutMin,
              swapPath: path,
            },
          ],
        ]
      );
      expect(execPayloadSecond).to.be.eq(taskDataSecond);

      await automator
        .connect(gelatoSigner)
        .exec(
          parseEther("0.01"),
          ETH_TOKEN_ADDRESS,
          autoGamma.address,
          autoGamma.address,
          taskDataSecond
        );

      const [canExecFinish, execPayloadFinish] =
        await resolver.getProcessableOrders();
      expect(canExecFinish).to.be.eq(false);
      const taskDataFinish = autoGamma.interface.encodeFunctionData(
        "processOrders",
        [[], []]
      );
      expect(execPayloadFinish).to.be.eq(taskDataFinish);

      const contractBalanceAfter = await usdc.balanceOf(autoGamma.address);
      const buyerBalanceAfter = await toToken.balanceOf(buyerAddress);
      const sellerBalanceAfter = await toToken.balanceOf(sellerAddress);

      const buyerDifference = buyerBalanceAfter.sub(buyerBalanceBefore);
      expect(buyerDifference).to.be.gte(
        buyerOrder1AmountOutMin.add(buyerOrder2AmountOutMin)
      );

      const sellerDifference = sellerBalanceAfter.sub(sellerBalanceBefore);
      expect(sellerDifference).to.be.gte(sellerOrderAmountOutMin);

      const contractDifference = contractBalanceAfter.sub(
        contractBalanceBefore
      );
      const buyerFee = await autoGamma.redeemFee();
      const buyerFeeTotal = buyerFee.mul(buyerPayout).div(10000);
      const sellerFee = await autoGamma.settleFee();
      const sellerFeeTotal = sellerFee.mul(sellerProceed).div(10000);
      expect(contractDifference).to.be.eq(buyerFeeTotal.add(sellerFeeTotal));
    });
  });
});
