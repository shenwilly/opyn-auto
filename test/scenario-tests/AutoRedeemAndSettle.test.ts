import hre, { ethers } from "hardhat";
import chai from "chai";
import {
  Controller,
  Otoken,
  MarginPool,
  GammaRedeemerV1,
  PokeMe,
  TaskTreasury,
  GammaRedeemerResolver,
  Oracle,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setupGammaContracts,
} from "../helpers/setup/GammaSetup";
import {
  ETH_TOKEN_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/address";
import {
  OTOKEN_DECIMALS,
  STRIKE_PRICE_DECIMALS,
  USDC_DECIMALS,
} from "../../constants/decimals";

import { BigNumber, constants, Contract } from "ethers/lib/ethers";
import { setupGelatoContracts } from "../helpers/setup/GelatoSetup";
import { setupAutoGammaContracts } from "../helpers/setup/AutoGammaSetup";
import { setExpiryPrice } from "../helpers/utils/GammaUtils";

const { expect } = chai;
const ZERO_ADDR = constants.AddressZero;

// oWETHUSDC/USDC-20AUG21-2300P
const OTOKEN_ADDRESS = "0xd585cce0bfaedae7797babe599c38d7c157e1e43";
const USDC_WALLET = "0xae2d4617c862309a3d75a0ffb358c7a5009c673f";

describe("Mainnet Fork: Auto Redeem", () => {
  let deployer: SignerWithAddress;

  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyerAddress: string;
  let sellerAddress: string;

  let controller: Controller;
  let marginPool: MarginPool;
  let oracle: Oracle;
  let gammaRedeemer: GammaRedeemerV1;
  let resolver: GammaRedeemerResolver;
  let automator: PokeMe;
  let automatorTreasury: TaskTreasury;

  let expiry: number;
  let usdc: Contract;

  let ethPut: Otoken;
  const strikePrice = "2000";

  before("setup contracts", async () => {
    [deployer, buyer, seller] = await ethers.getSigners();
    buyerAddress = buyer.address;
    sellerAddress = seller.address;

    [, , , oracle, marginPool, , controller] = await setupGammaContracts();
    [automator, automatorTreasury] = await setupGelatoContracts();
    [gammaRedeemer, resolver] = await setupAutoGammaContracts(
      deployer,
      automator.address,
      automatorTreasury.address
    );
    ethPut = (await ethers.getContractAt("Otoken", OTOKEN_ADDRESS)) as Otoken;

    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
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
      .approve(gammaRedeemer.address, parseUnits("2", OTOKEN_DECIMALS));
    await setOperator(seller, controller, gammaRedeemer.address, true);
    await gammaRedeemer.startAutomator(resolver.address);
    await automatorTreasury
      .connect(deployer)
      .depositFunds(gammaRedeemer.address, ETH_TOKEN_ADDRESS, 0, {
        value: parseEther("0.1"),
      });
  });

  describe("auto redeem", async () => {
    let buyerOrderId: BigNumber;
    let buyerOrderId2: BigNumber;
    let sellerOrderId: BigNumber;
    let vaultId: BigNumber;

    before(async () => {
      expiry = (await ethPut.expiryTimestamp()).toNumber();
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPrice(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(strikePrice, STRIKE_PRICE_DECIMALS)
      );

      buyerOrderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, parseUnits("1", OTOKEN_DECIMALS), 0);
      buyerOrderId2 = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, parseUnits("1", OTOKEN_DECIMALS), 0);

      sellerOrderId = await gammaRedeemer.getOrdersLength();
      vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer.connect(seller).createOrder(ZERO_ADDR, 0, vaultId);
    });

    it("should redeem otoken & settle vault", async () => {
      const buyerPayout = await controller.getPayout(
        ethPut.address,
        parseUnits("2", OTOKEN_DECIMALS)
      );
      const sellerProceed = await controller.getProceed(sellerAddress, vaultId);

      const contractBalanceBefore = await usdc.balanceOf(gammaRedeemer.address);
      const buyerBalanceBefore = await usdc.balanceOf(buyerAddress);
      const sellerBalanceBefore = await usdc.balanceOf(sellerAddress);

      expect(await gammaRedeemer.shouldProcessOrder(buyerOrderId)).to.be.eq(
        true
      );
      expect(await gammaRedeemer.shouldProcessOrder(sellerOrderId)).to.be.eq(
        true
      );

      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(true);
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[buyerOrderId, sellerOrderId]]
      );
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
          gammaRedeemer.address,
          gammaRedeemer.address,
          taskData
        );

      const [canExecSecond, execPayloadSecond] =
        await resolver.getProcessableOrders();
      expect(canExecSecond).to.be.eq(true);
      const taskDataSecond = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[buyerOrderId2]]
      );
      expect(execPayloadSecond).to.be.eq(taskDataSecond);

      await automator
        .connect(gelatoSigner)
        .exec(
          parseEther("0.01"),
          ETH_TOKEN_ADDRESS,
          gammaRedeemer.address,
          gammaRedeemer.address,
          taskDataSecond
        );

      const [canExecFinish, execPayloadFinish] =
        await resolver.getProcessableOrders();
      expect(canExecFinish).to.be.eq(false);
      const taskDataFinish = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[]]
      );
      expect(execPayloadFinish).to.be.eq(taskDataFinish);

      const contractBalanceAfter = await usdc.balanceOf(gammaRedeemer.address);
      const buyerBalanceAfter = await usdc.balanceOf(buyerAddress);
      const sellerBalanceAfter = await usdc.balanceOf(sellerAddress);

      const buyerDifference = buyerBalanceAfter.sub(buyerBalanceBefore);
      const buyerFee = await gammaRedeemer.redeemFee();
      const buyerFeeTotal = buyerFee.mul(buyerPayout).div(10000);
      expect(buyerDifference).to.be.eq(buyerPayout.sub(buyerFeeTotal));

      const sellerDifference = sellerBalanceAfter.sub(sellerBalanceBefore);
      const sellerFee = await gammaRedeemer.settleFee();
      const sellerFeeTotal = sellerFee.mul(sellerProceed).div(10000);
      expect(sellerDifference).to.be.eq(sellerProceed.sub(sellerFeeTotal));

      const contractDifference = contractBalanceAfter.sub(
        contractBalanceBefore
      );
      expect(contractDifference).to.be.eq(buyerFeeTotal.add(sellerFeeTotal));
    });
  });
});
