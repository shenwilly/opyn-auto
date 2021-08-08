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

describe("Gamma Redeemer Resolver", () => {
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

  beforeEach("setup contracts", async () => {
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

    const TaskTreasuryFactory = (await ethers.getContractFactory(
      "TaskTreasury",
      deployer
    )) as TaskTreasury__factory;
    automatorTreasury = await TaskTreasuryFactory.deploy(deployerAddress);

    // deploy Vault Operator
    const PokeMeFactory = (await ethers.getContractFactory(
      "PokeMe",
      deployer
    )) as PokeMe__factory;
    automator = await PokeMeFactory.deploy(
      deployerAddress,
      automatorTreasury.address
    );
    await automatorTreasury.addWhitelistedService(automator.address);

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemerV1",
      deployer
    )) as GammaRedeemerV1__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(
      addressBook.address,
      automator.address,
      automatorTreasury.address
    );

    const ResolverFactory = (await ethers.getContractFactory(
      "GammaRedeemerResolver",
      deployer
    )) as GammaRedeemerResolver__factory;
    resolver = await ResolverFactory.deploy(gammaRedeemer.address);
  });

  beforeEach(async () => {
    const now = (await time.latest()).toNumber();
    expiry = createValidExpiry(now, 1000);

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

  describe("canProcessOrder()", async () => {
    it("should return false if otoken has not expired & not settled", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

      expect(
        await gammaRedeemer.hasExpiredAndSettlementAllowed(ethPut.address)
      ).to.be.eq(false);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if vault is not valid", async () => {
      await setOperator(seller, controller, gammaRedeemer.address, true);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter.add(1));

      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if redeemer is not operator", async () => {
      await setOperator(seller, controller, gammaRedeemer.address, false);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter);

      expect(await gammaRedeemer.isOperatorOf(sellerAddress)).to.be.eq(false);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if vault otoken has not expired & not settled", async () => {
      await setOperator(seller, controller, gammaRedeemer.address, true);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter);

      const [vault] = await gammaRedeemer.getVaultWithDetails(
        sellerAddress,
        vaultCounter
      );
      expect(vault[0][0]).to.be.eq(ethPut.address);
      expect(
        await gammaRedeemer.hasExpiredAndSettlementAllowed(ethPut.address)
      ).to.be.eq(false);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return true if buy order could be processed", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

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

      expect(
        await gammaRedeemer.hasExpiredAndSettlementAllowed(ethPut.address)
      ).to.be.eq(true);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(true);
    });
    it("should return true if sell order could be processed", async () => {
      await setOperator(seller, controller, gammaRedeemer.address, true);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter);

      const [vault] = await gammaRedeemer.getVaultWithDetails(
        sellerAddress,
        vaultCounter
      );
      expect(vault[0][0]).to.be.eq(ethPut.address);
      expect(await gammaRedeemer.isOperatorOf(sellerAddress)).to.be.eq(true);

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

      expect(
        await gammaRedeemer.hasExpiredAndSettlementAllowed(ethPut.address)
      ).to.be.eq(true);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(true);
    });
  });

  describe("containDuplicateOrderType()", async () => {
    let hashes: string[];
    let address: string;
    before(async () => {
      address = ethPut.address;
      const hash1 = await resolver.getOrderHash({
        owner: buyerAddress,
        otoken: address,
        amount: BigNumber.from(1000),
        vaultId: BigNumber.from(0),
        isSeller: false,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      });
      const hash2 = await resolver.getOrderHash({
        owner: sellerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(1),
        isSeller: true,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      });

      hashes = [hash1, hash2];
    });
    it("should return true if there is duplicate", async () => {
      const buyOrder = {
        owner: buyerAddress,
        otoken: address,
        amount: BigNumber.from(1),
        vaultId: BigNumber.from(0),
        isSeller: false,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      };
      const hash = await resolver.getOrderHash(buyOrder);
      expect(
        await resolver.containDuplicateOrderType(buyOrder, hashes)
      ).to.be.eq(true);

      const sellOrder = {
        owner: sellerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(1),
        isSeller: true,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      };
      expect(
        await resolver.containDuplicateOrderType(sellOrder, hashes)
      ).to.be.eq(true);
    });
    it("should return false if there is no duplicate", async () => {
      const buyOrder = {
        owner: buyerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(1),
        vaultId: BigNumber.from(0),
        isSeller: false,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      };
      expect(
        await resolver.containDuplicateOrderType(buyOrder, hashes)
      ).to.be.eq(false);

      const sellOrder = {
        owner: sellerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(3),
        isSeller: true,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      };
      expect(
        await resolver.containDuplicateOrderType(sellOrder, hashes)
      ).to.be.eq(false);
    });
  });

  describe("getOrderHash()", async () => {
    it("should return buyer hash", async () => {
      const buyerHash = await resolver.getOrderHash({
        owner: buyerAddress,
        otoken: ethPut.address,
        amount: BigNumber.from(1000),
        vaultId: BigNumber.from(0),
        isSeller: false,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      });
      const encoded = ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        [buyerAddress, ethPut.address]
      );
      expect(buyerHash).to.be.eq(ethers.utils.keccak256(encoded));

      const encodedWrong = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [buyerAddress, BigNumber.from(1)]
      );
      expect(buyerHash).to.be.not.eq(ethers.utils.keccak256(encodedWrong));
    });
    it("should return seller hash", async () => {
      const sellerHash = await resolver.getOrderHash({
        owner: sellerAddress,
        otoken: ethPut.address,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(1),
        isSeller: true,
        toETH: false,
        fee: BigNumber.from(0),
        finished: false,
      });

      const encoded = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [sellerAddress, BigNumber.from(1)]
      );
      expect(sellerHash).to.be.eq(ethers.utils.keccak256(encoded));

      const encodedWrong = ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        [buyerAddress, ethPut.address]
      );
      expect(sellerHash).to.be.not.eq(ethers.utils.keccak256(encodedWrong));
    });
  });

  describe("getProcessableOrders()", async () => {
    it("should return empty list if no order is processable", async () => {
      expect(await gammaRedeemer.getOrdersLength()).to.be.eq(0);
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );
      const processableOrders = await resolver.getProcessableOrders();
      expect(processableOrders.length).to.be.eq(0);
    });
    it("should skip finished orders", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

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

      const processableOrdersBefore = await resolver.getProcessableOrders();
      expect(processableOrdersBefore.length).to.be.eq(1);

      await gammaRedeemer.connect(deployer).processOrder(orderId);

      const processableOrdersAfter = await resolver.getProcessableOrders();
      expect(processableOrdersAfter.length).to.be.eq(0);
    });
    it("should skip same order types", async () => {
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

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

      const processableOrders = await resolver.getProcessableOrders();
      expect(processableOrders.length).to.be.eq(1);
    });
    it("should return list of processable orders", async () => {
      const orderId1 = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );
      const orderId2 = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), optionDecimals),
          0
        );

      const orderId3 = await gammaRedeemer.getOrdersLength();
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer.connect(seller).createOrder(ZERO_ADDR, 0, vaultId);

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

      const processableOrders = await resolver.getProcessableOrders();
      expect(processableOrders.length).to.be.eq(2);
      expect(
        processableOrders.findIndex(
          (orderId: BigNumber) => orderId.toString() === orderId1.toString()
        )
      ).to.be.gte(0);
      expect(
        processableOrders.findIndex(
          (orderId: BigNumber) => orderId.toString() === orderId2.toString()
        )
      ).to.be.lt(0);
      expect(
        processableOrders.findIndex(
          (orderId: BigNumber) => orderId.toString() === orderId3.toString()
        )
      ).to.be.gte(0);
    });
  });
});
