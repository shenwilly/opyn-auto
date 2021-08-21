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
  PokeMe,
  TaskTreasury,
  GammaRedeemerResolver,
  Oracle,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import { BigNumber, Contract } from "ethers/lib/ethers";
import { createValidExpiry } from "../helpers/utils/time";
import {
  UNISWAP_V2_ROUTER_02,
  USDC_ADDRESS,
  WETH_ADDRESS,
  ZERO_ADDR,
} from "../../constants/address";
import { mintUsdc } from "../helpers/utils/token";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  setOperator,
  getOrCreateOtoken,
  setExpiryPriceAndEndDisputePeriod,
  whitelistCollateral,
  whitelistProduct,
} from "../helpers/utils/GammaUtils";
import { setupGelatoContracts } from "../helpers/setup/GelatoSetup";
import { setupAutoGammaContracts } from "../helpers/setup/AutoGammaSetup";
import {
  OTOKEN_DECIMALS,
  STRIKE_PRICE_DECIMALS,
  USDC_DECIMALS,
} from "../../constants/decimals";
import { setUniPair } from "../helpers/utils/AutoGammaUtils";
const { time, expectRevert } = require("@openzeppelin/test-helpers");

const { expect } = chai;

describe("Gamma Redeemer Resolver", () => {
  let deployer: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
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
  const optionsAmount = 10;
  const collateralAmount = optionsAmount * strikePrice;
  const optionAmount = 1;

  let expiry: number;
  let snapshotId: string;

  before("setup contracts", async () => {
    [deployer, buyer, seller] = await ethers.getSigners();
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
    await gammaRedeemer.startAutomator(resolver.address);

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
    expiry = createValidExpiry(now, 1000);

    ethPut = await getOrCreateOtoken(
      otokenFactory,
      WETH_ADDRESS,
      USDC_ADDRESS,
      USDC_ADDRESS,
      parseUnits(strikePrice.toString(), STRIKE_PRICE_DECIMALS),
      expiry,
      true
    );

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);

    const initialAmountUsdc = parseUnits(
      collateralAmount.toString(),
      USDC_DECIMALS
    ).mul(2);
    await mintUsdc(initialAmountUsdc, sellerAddress);
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
  });

  describe("setMaxSlippage()", async () => {
    it("should revert if not owner", async () => {
      await expectRevert.unspecified(resolver.connect(buyer).setMaxSlippage(1));
    });
    it("should revert maxSlippage is higher than 500", async () => {
      await expectRevert.unspecified(
        resolver.connect(deployer).setMaxSlippage(10000)
      );
    });
    it("should set new maxSlippage", async () => {
      const newSlippage = 1;
      expect(await resolver.maxSlippage()).to.not.be.eq(newSlippage);
      await resolver.connect(deployer).setMaxSlippage(newSlippage);
      expect(await resolver.maxSlippage()).to.be.eq(newSlippage);
    });
  });

  describe("canProcessOrder()", async () => {
    it("should return false if otoken has not expired & not settled", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
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
        .createOrder(ZERO_ADDR, 0, vaultCounter.add(1), ZERO_ADDR);

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
        .createOrder(ZERO_ADDR, 0, vaultCounter, ZERO_ADDR);

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
        .createOrder(ZERO_ADDR, 0, vaultCounter, ZERO_ADDR);

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
    it("should return false if swap pair is not allowed (buyer)", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      await setUniPair(gammaRedeemer, collateral, targetToken, true);

      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          targetToken
        );
      await setUniPair(gammaRedeemer, collateral, targetToken, false);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return false if swap pair is not allowed (seller)", async () => {
      const collateral = await ethPut.collateralAsset(); // USDC
      const targetToken = WETH_ADDRESS;
      await setUniPair(gammaRedeemer, collateral, targetToken, true);

      await setOperator(seller, controller, gammaRedeemer.address, true);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter, targetToken);
      await setUniPair(gammaRedeemer, collateral, targetToken, false);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      expect(await resolver.canProcessOrder(orderId)).to.be.eq(false);
    });
    it("should return true if buy order could be processed", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
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
        .createOrder(ZERO_ADDR, 0, vaultCounter, ZERO_ADDR);

      const [vault] = await gammaRedeemer.getVaultWithDetails(
        sellerAddress,
        vaultCounter
      );
      expect(vault[0][0]).to.be.eq(ethPut.address);
      expect(await gammaRedeemer.isOperatorOf(sellerAddress)).to.be.eq(true);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      expect(
        await gammaRedeemer.hasExpiredAndSettlementAllowed(ethPut.address)
      ).to.be.eq(true);
      expect(await resolver.canProcessOrder(orderId)).to.be.eq(true);
    });
  });

  describe("getOrderPayout()", async () => {
    it("should return correct buyer payout", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      const amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);

      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, amount, 0, ZERO_ADDR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);
      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const payout = await controller.getPayout(ethPut.address, amount);
      const [, payoutAmount] = await resolver.getOrderPayout(orderId);
      expect(payoutAmount).to.be.eq(payout);
    });
    it("should return correct seller payout", async () => {
      await setOperator(seller, controller, gammaRedeemer.address, true);
      const vaultCounter = await controller.getAccountVaultCounter(
        sellerAddress
      );
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultCounter, ZERO_ADDR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const proceed = await controller.getProceed(sellerAddress, vaultCounter);
      const [, payoutAmount] = await resolver.getOrderPayout(orderId);
      expect(payoutAmount).to.be.eq(proceed);
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
        toToken: ZERO_ADDR,
        fee: BigNumber.from(0),
        finished: false,
      });
      const hash2 = await resolver.getOrderHash({
        owner: sellerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(1),
        isSeller: true,
        toToken: ZERO_ADDR,
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
        toToken: ZERO_ADDR,
        fee: BigNumber.from(0),
        finished: false,
      };
      // const hash = await resolver.getOrderHash(buyOrder);
      expect(
        await resolver.containDuplicateOrderType(buyOrder, hashes)
      ).to.be.eq(true);

      const sellOrder = {
        owner: sellerAddress,
        otoken: ZERO_ADDR,
        amount: BigNumber.from(0),
        vaultId: BigNumber.from(1),
        isSeller: true,
        toToken: ZERO_ADDR,
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
        toToken: ZERO_ADDR,
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
        toToken: ZERO_ADDR,
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
        toToken: ZERO_ADDR,
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
        toToken: ZERO_ADDR,
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
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );
      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(false);
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[], []]
      );
      expect(execPayload).to.be.eq(taskData);
    });
    it("should skip finished orders", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const [canExecBefore, execPayloadBefore] =
        await resolver.getProcessableOrders();
      expect(canExecBefore).to.be.eq(true);
      const taskDataBefore = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [
          [orderId],
          [
            {
              swapAmountOutMin: 0,
              swapPath: [],
            },
          ],
        ]
      );
      expect(execPayloadBefore).to.be.eq(taskDataBefore);

      await gammaRedeemer.connect(deployer).processOrder(orderId, {
        swapAmountOutMin: 0,
        swapPath: [],
      });

      const [canExecAfter, execPayloadAfter] =
        await resolver.getProcessableOrders();
      expect(canExecAfter).to.be.eq(false);
      const taskDataAfter = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [[], []]
      );
      expect(execPayloadAfter).to.be.eq(taskDataAfter);
    });
    it("should skip same order types", async () => {
      const orderId = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(true);
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [
          [orderId],
          [
            {
              swapAmountOutMin: 0,
              swapPath: [],
            },
          ],
        ]
      );
      expect(execPayload).to.be.eq(taskData);
    });
    it("should return list of processable orders", async () => {
      const orderId1 = await gammaRedeemer.getOrdersLength();
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );
      await gammaRedeemer
        .connect(buyer)
        .createOrder(
          ethPut.address,
          parseUnits(optionAmount.toString(), OTOKEN_DECIMALS),
          0,
          ZERO_ADDR
        );

      const orderId3 = await gammaRedeemer.getOrdersLength();
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, ZERO_ADDR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(true);
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [
          [orderId1, orderId3],
          [
            {
              swapAmountOutMin: 0,
              swapPath: [],
            },
            {
              swapAmountOutMin: 0,
              swapPath: [],
            },
          ],
        ]
      );
      expect(execPayload).to.be.eq(taskData);
    });
    it("should return list of processable orders (with toToken)", async () => {
      const uniRouter = await ethers.getContractAt(
        "IUniswapRouter",
        UNISWAP_V2_ROUTER_02
      );

      const collateral = await ethPut.collateralAsset();
      const targetToken = WETH_ADDRESS;
      await setUniPair(gammaRedeemer, collateral, targetToken, true);

      const orderId1 = await gammaRedeemer.getOrdersLength();
      const order1Amount = parseUnits(optionAmount.toString(), OTOKEN_DECIMALS);
      await gammaRedeemer
        .connect(buyer)
        .createOrder(ethPut.address, order1Amount, 0, targetToken);

      const orderId2 = await gammaRedeemer.getOrdersLength();
      const vaultId = await controller.getAccountVaultCounter(sellerAddress);
      await gammaRedeemer
        .connect(seller)
        .createOrder(ZERO_ADDR, 0, vaultId, targetToken);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const path = [collateral, targetToken];
      const maxSlippage = await resolver.maxSlippage();

      let order1Payout = await controller.getPayout(
        ethPut.address,
        order1Amount
      );
      const [, , , , , , order1Fee, ,] = await gammaRedeemer.orders(orderId1);
      const order1FeeTotal = order1Fee.mul(order1Payout).div(10000);
      order1Payout = order1Payout.sub(order1FeeTotal);
      const order1Amounts = await uniRouter.getAmountsOut(order1Payout, path);
      let order1AmountOutMin = order1Amounts[1];
      order1AmountOutMin = order1AmountOutMin.sub(
        order1AmountOutMin.mul(maxSlippage).div(10000)
      );

      let order2Payout = await controller.getProceed(sellerAddress, vaultId);
      const [, , , , , , order2Fee, ,] = await gammaRedeemer.orders(orderId2);
      const order2FeeTotal = order2Fee.mul(order2Payout).div(10000);
      order2Payout = order2Payout.sub(order2FeeTotal);
      let order2Amounts = await uniRouter.getAmountsOut(order2Payout, path);
      let order2AmountOutMin = order2Amounts[1];
      order2AmountOutMin = order2AmountOutMin.sub(
        order2AmountOutMin.mul(maxSlippage).div(10000)
      );

      const [canExec, execPayload] = await resolver.getProcessableOrders();
      expect(canExec).to.be.eq(true);
      const taskData = gammaRedeemer.interface.encodeFunctionData(
        "processOrders",
        [
          [orderId1, orderId2],
          [
            {
              swapAmountOutMin: order1AmountOutMin,
              swapPath: path,
            },
            {
              swapAmountOutMin: order2AmountOutMin,
              swapPath: path,
            },
          ],
        ]
      );
      expect(execPayload).to.be.eq(taskData);
    });
  });
});
