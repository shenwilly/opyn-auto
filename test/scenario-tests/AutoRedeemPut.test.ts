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
  GammaOperator,
  PokeMe__factory,
  PokeMe,
  TaskTreasury__factory,
  TaskTreasury,
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
} from "../../typechain";
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import {
  createOtoken,
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  setupGammaContracts,
} from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";
import { BigNumber } from "@ethersproject/bignumber";
import { ETH_TOKEN_ADDRESS } from "../helpers/constants";
import { constants } from "ethers/lib/ethers";
const { time, expectRevert } = require("@openzeppelin/test-helpers");

const { expect } = chai;
const ZERO_ADDR = constants.AddressZero;

describe("Scenario: Auto Redeem Put", () => {
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
  let automator: PokeMe;
  let automatorTreasury: TaskTreasury;

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
    ] = await setupGammaContracts();

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

    const TaskTreasuryFactory = (await ethers.getContractFactory(
      "TaskTreasury",
      buyer
    )) as TaskTreasury__factory;
    automatorTreasury = await TaskTreasuryFactory.deploy(deployerAddress);

    // deploy Vault Operator
    const PokeMeFactory = (await ethers.getContractFactory(
      "PokeMe",
      buyer
    )) as PokeMe__factory;
    automator = await PokeMeFactory.deploy(
      deployerAddress,
      automatorTreasury.address
    );
    await automatorTreasury.addWhitelistedService(automator.address);

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemerV1",
      buyer
    )) as GammaRedeemerV1__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(
      addressBook.address,
      automator.address,
      automatorTreasury.address
    );

    const ResolverFactory = (await ethers.getContractFactory(
      "GammaRedeemerResolver",
      buyer
    )) as GammaRedeemerResolver__factory;
    resolver = await ResolverFactory.deploy(gammaRedeemer.address);

    const now = (await time.latest()).toNumber();
    expiry = createValidExpiry(now, 1);

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

    await gammaRedeemer.startAutomator(resolver.address);
  });

  describe("auto redeem", async () => {
    before(async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
    });
    it("should redeem otoken", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

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

      const balanceBefore = await usdc.balanceOf(buyerAddress);

      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);

      const orderIds = await resolver.getProcessableOrders();
      expect(orderIds.findIndex((id) => id == orderId) >= 0);

      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[orderId]]
      );

      await automator
        .connect(deployer)
        .exec(
          0,
          ETH_TOKEN_ADDRESS,
          gammaRedeemer.address,
          gammaRedeemer.address,
          taskData
        );

      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);

      // TODO: calculate & expect exact payout
    });
    it("should settle vault", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer.connect(seller).createOrder(ZERO_ADDR, 0, vaultId);
      await setOperator(seller, controller, gammaRedeemer.address, true);

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

      const balanceBefore = await usdc.balanceOf(sellerAddress);

      expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.eq(true);

      const orderIds = await resolver.getProcessableOrders();
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [orderIds]
      );

      await automator
        .connect(deployer)
        .exec(
          0,
          ETH_TOKEN_ADDRESS,
          gammaRedeemer.address,
          gammaRedeemer.address,
          taskData
        );

      const balanceAfter = await usdc.balanceOf(sellerAddress);
      expect(balanceAfter).to.be.gt(balanceBefore);

      // TODO: calculate & expect exact payout
    });
  });
});
