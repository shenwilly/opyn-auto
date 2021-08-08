import hre, { ethers } from "hardhat";
import chai from "chai";
import {
  Controller,
  Otoken,
  MarginPool,
  GammaRedeemerV1__factory,
  GammaRedeemerV1,
  PokeMe,
  TaskTreasury,
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
  Oracle,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
} from "../helpers/setup/GammaSetup";
import { ETH_TOKEN_ADDRESS } from "../helpers/constants";
import { BigNumber, constants, Contract } from "ethers/lib/ethers";

const { expect } = chai;
const ZERO_ADDR = constants.AddressZero;

const POKEME_ADDRESS = "0x89a26d08c26E00cE935a775Ba74A984Ad346679b";
const TREASURY_ADDRESS = "0x66e2F69df68C8F56837142bE2E8C290EfE76DA9f";
const ADDRESS_BOOK_ADDRESS = "0x1E31F2DCBad4dc572004Eae6355fB18F9615cBe4";
const CONTROLLER_ADDRESS = "0x4ccc2339F87F6c59c6893E1A678c2266cA58dC72";
const MARGIN_POOL_ADDRESS = "0x5934807cC0654d46755eBd2848840b616256C6Ef";
const ORACLE_ADDRESS = "0x789cD7AB3742e23Ce0952F6Bc3Eb3A73A0E08833";
const OTOKEN_ADDRESS = "0xd585cce0bfaedae7797babe599c38d7c157e1e43";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_WALLET = "0xae2d4617c862309a3d75a0ffb358c7a5009c673f";

describe("Mainnet Fork: Auto Redeem", () => {
  let deployer: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let deployerAddress: string;
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

  const strikePrice = 2300;
  const optionAmount = 1;
  const collateralAmount = optionAmount * strikePrice;

  const strikePriceDecimals = 8;
  const optionDecimals = 8;
  const usdcDecimals = 6;

  before("setup contracts", async () => {
    [deployer, buyer, seller] = await ethers.getSigners();
    deployerAddress = deployer.address;
    buyerAddress = buyer.address;
    sellerAddress = seller.address;
    automatorTreasury = (await ethers.getContractAt(
      "TaskTreasury",
      TREASURY_ADDRESS
    )) as TaskTreasury;
    automator = (await ethers.getContractAt(
      "PokeMe",
      POKEME_ADDRESS
    )) as PokeMe;
    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    controller = (await ethers.getContractAt(
      "Controller",
      CONTROLLER_ADDRESS
    )) as Controller;
    marginPool = (await ethers.getContractAt(
      "MarginPool",
      MARGIN_POOL_ADDRESS
    )) as MarginPool;
    oracle = (await ethers.getContractAt("Oracle", ORACLE_ADDRESS)) as Oracle;

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDC_WALLET],
    });
    // await hre.network.provider.request({
    //   method: "hardhat_impersonateAccount",
    //   params: [WETH_PRICER],
    // });

    // await deployer.sendTransaction({
    //   to: WETH_PRICER,
    //   value: parseEther("1")
    // });
    const usdcWalletSigner = await ethers.getSigner(USDC_WALLET);
    await usdc
      .connect(usdcWalletSigner)
      .transfer(
        sellerAddress,
        parseUnits(collateralAmount.toString(), usdcDecimals)
      );

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemerV1",
      deployer
    )) as GammaRedeemerV1__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(
      ADDRESS_BOOK_ADDRESS,
      automator.address,
      automatorTreasury.address
    );
    const ResolverFactory = (await ethers.getContractFactory(
      "GammaRedeemerResolver",
      deployer
    )) as GammaRedeemerResolver__factory;
    resolver = await ResolverFactory.deploy(gammaRedeemer.address);

    ethPut = (await ethers.getContractAt("Otoken", OTOKEN_ADDRESS)) as Otoken;

    const initialAmountUsdc = parseUnits(
      collateralAmount.toString(),
      usdcDecimals
    ).mul(2);
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
    let sellerOrderId: BigNumber;
    let vaultId: BigNumber;
    before(async () => {
      expiry = (await ethPut.expiryTimestamp()).toNumber();
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      const owner = await oracle.owner();
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [owner],
      });
      const ownerSigner = await ethers.getSigner(owner);

      await deployer.sendTransaction({
        to: owner,
        value: parseEther("1"),
      });

      await oracle
        .connect(ownerSigner)
        .setAssetPricer("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", owner);
      await oracle
        .connect(ownerSigner)
        .setExpiryPrice(
          "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          expiry,
          parseUnits("2000", strikePriceDecimals)
        );
      await oracle
        .connect(ownerSigner)
        .setStablePrice(
          "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          parseUnits("1", strikePriceDecimals)
        );

      buyerOrderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

      sellerOrderId = await gammaRedeemer.getOrdersLength();
      vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer.connect(seller).createOrder(ZERO_ADDR, 0, vaultId);
    });
    it("should redeem otoken & settle vault", async () => {
      const buyerPayout = await controller.getPayout(
        ethPut.address,
        parseUnits(optionAmount.toString(), optionDecimals)
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

      const orderIds = await resolver.getProcessableOrders();
      expect(orderIds.findIndex((id) => id == buyerOrderId) >= 0);
      expect(orderIds.findIndex((id) => id == sellerOrderId) >= 0);
      expect(orderIds.length).to.be.eq(2);

      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [orderIds]
      );

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
