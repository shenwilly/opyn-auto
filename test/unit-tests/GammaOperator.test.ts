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
  GammaOperatorWrapper__factory,
  GammaOperatorWrapper,
  Oracle,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";
import { Contract } from "@ethersproject/contracts";
import {
  ETH_TOKEN_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
  ZERO_ADDR,
} from "../../constants/address";
import {
  getActionDepositCollateral,
  getActionMintShort,
  getActionOpenVault,
  getOrCreateOtoken,
  setExpiryPriceAndEndDisputePeriod,
  setOperator,
  whitelistCollateral,
  whitelistProduct,
} from "../helpers/utils/GammaUtils";
import { createValidExpiry } from "../helpers/utils/time";
import { mintUsdc } from "../helpers/utils/token";
import {
  OTOKEN_DECIMALS,
  STRIKE_PRICE_DECIMALS,
  USDC_DECIMALS,
} from "../../constants/decimals";
import { impersonateAccount } from "../helpers/utils/misc";

const { expect } = chai;
const { time, expectRevert } = require("@openzeppelin/test-helpers");

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
  let oracle: Oracle;
  let controller: Controller;
  let gammaOperator: GammaOperatorWrapper;

  let usdc: Contract;
  let ethPut: Otoken;

  let expiry: number;
  let snapshotId: string;

  let strikePrice = 200;
  let collateralAmount = parseUnits("1000", USDC_DECIMALS);

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

    const GammaOperatorWrapperFactory = (await ethers.getContractFactory(
      "GammaOperatorWrapper",
      deployer
    )) as GammaOperatorWrapper__factory;
    gammaOperator = await GammaOperatorWrapperFactory.deploy(
      addressBook.address
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

    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    await mintUsdc(parseUnits("100000", USDC_DECIMALS), sellerAddress);
    await usdc
      .connect(seller)
      .approve(marginPool.address, parseUnits("100000", USDC_DECIMALS));

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  describe("redeemOtoken()", async () => {
    it("should redeem otoken correctly", async () => {
      let shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          USDC_ADDRESS,
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

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const usdcBalanceBefore = await usdc.balanceOf(buyerAddress);
      const optionBalanceBefore = await ethPut.balanceOf(buyerAddress);
      const payout = await controller.getPayout(
        ethPut.address,
        shortOptionAmount
      );

      await gammaOperator
        .connect(buyer)
        .redeem(buyerAddress, ethPut.address, shortOptionAmount);

      const usdcBalanceAfter = await usdc.balanceOf(buyerAddress);
      const optionBalanceAfter = await ethPut.balanceOf(buyerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(payout);

      expect(optionBalanceBefore).to.be.gt(0);
      expect(optionBalanceAfter).to.be.eq(0);
    });
  });

  describe("settleVault()", async () => {
    it("should settle vault correctly", async () => {
      let shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actionArgs = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          USDC_ADDRESS,
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

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits(((strikePrice * 98) / 100).toString(), STRIKE_PRICE_DECIMALS)
      );

      const usdcBalanceBefore = await usdc.balanceOf(sellerAddress);
      const proceed = await controller.getProceed(sellerAddress, vaultId);

      await gammaOperator.connect(buyer).settle(sellerAddress, vaultId);

      const usdcBalanceAfter = await usdc.balanceOf(sellerAddress);

      expect(usdcBalanceAfter).to.be.gt(usdcBalanceBefore);
      const difference = usdcBalanceAfter.sub(usdcBalanceBefore);
      expect(difference).to.be.eq(proceed);
    });
  });

  describe("shouldRedeemOtoken()", async () => {
    let strikePriceITM = 150;
    let strikePriceOTM = 250;

    const shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

    beforeEach(async () => {
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
          asset: USDC_ADDRESS,
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
      beforeEach(async () => {
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
        await setExpiryPriceAndEndDisputePeriod(
          oracle,
          WETH_ADDRESS,
          expiry,
          parseUnits(strikePriceITM.toString(), STRIKE_PRICE_DECIMALS)
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

        await setExpiryPriceAndEndDisputePeriod(
          oracle,
          WETH_ADDRESS,
          expiry,
          parseUnits(strikePriceOTM.toString(), STRIKE_PRICE_DECIMALS)
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

        await setExpiryPriceAndEndDisputePeriod(
          oracle,
          WETH_ADDRESS,
          expiry,
          parseUnits(strikePriceITM.toString(), STRIKE_PRICE_DECIMALS)
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
      await setOperator(seller, controller, gammaOperator.address, true);
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);

      const actions = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          USDC_ADDRESS,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          parseUnits("5", OTOKEN_DECIMALS)
        ),
      ];
      await controller.connect(seller).operate(actions);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(oracle, WETH_ADDRESS, expiry, 1);

      expect(
        await gammaOperator.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(false);
    });
    it("should return true if vault can be settled", async () => {
      await setOperator(seller, controller, gammaOperator.address, true);
      const vaultId = (
        await controller.getAccountVaultCounter(sellerAddress)
      ).add(1);
      const actions = [
        getActionOpenVault(sellerAddress, vaultId.toString()),
        getActionDepositCollateral(
          sellerAddress,
          vaultId.toString(),
          USDC_ADDRESS,
          collateralAmount
        ),
        getActionMintShort(
          sellerAddress,
          vaultId.toString(),
          ethPut.address,
          parseUnits("1", OTOKEN_DECIMALS)
        ),
      ];
      await controller.connect(seller).operate(actions);

      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits((strikePrice + 10).toString(), STRIKE_PRICE_DECIMALS)
      );

      expect(
        await gammaOperator.shouldSettleVault(sellerAddress, vaultId)
      ).to.be.eq(true);
    });
  });

  describe("getRedeemPayout()", async () => {
    it("should return the same value as gamma controller", async () => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await ethers.provider.send("evm_mine", []);

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits((strikePrice + 10).toString(), STRIKE_PRICE_DECIMALS)
      );

      const payoutOperator = await gammaOperator.getRedeemPayout(
        ethPut.address,
        parseUnits("100", OTOKEN_DECIMALS)
      );
      const payoutGamma = await controller.getPayout(
        ethPut.address,
        parseUnits("100", OTOKEN_DECIMALS)
      );
      expect(payoutOperator).to.be.eq(payoutGamma);
    });
  });

  describe("getRedeemableAmount()", async () => {
    it("should return the smallest value", async () => {
      const shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

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
          asset: USDC_ADDRESS,
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
      const shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

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
          asset: USDC_ADDRESS,
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

      expect(vaultGamma[2][0]).to.be.eq(USDC_ADDRESS);
      expect(vaultGamma[2][0]).to.be.eq(vaultOperator[2][0]);
      expect(vaultGamma[3][0]).to.be.eq(vaultOperator[3][0]);
      expect(vaultGamma[5][0]).to.be.eq(vaultOperator[5][0]);

      expect(vaultTypeGamma).to.be.eq(vaultTypeOperator);
      expect(timestampGamma).to.be.eq(timestampOperator);
    });
  });

  describe("getVault()", async () => {
    it("should return the same value as Gamma controller", async () => {
      const shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

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
          asset: USDC_ADDRESS,
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

      const vaultGamma = await controller.getVault(
        sellerAddress,
        vaultId.toString()
      );
      const vaultOperator = await gammaOperator.getVault(
        sellerAddress,
        vaultId.toString()
      );
      expect(vaultGamma[0][0]).to.be.eq(ethPut.address);
      expect(vaultGamma[0][0]).to.be.eq(vaultOperator[0][0]);

      expect(vaultGamma[2][0]).to.be.eq(USDC_ADDRESS);
      expect(vaultGamma[2][0]).to.be.eq(vaultOperator[2][0]);
      expect(vaultGamma[3][0]).to.be.eq(vaultOperator[3][0]);
      expect(vaultGamma[5][0]).to.be.eq(vaultOperator[5][0]);
    });
  });

  describe("getVaultOtokenByVault()", async () => {
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
        gammaOperator.getVaultOtokenByVault(vault),
        "reverted with panic code 0x1 (Assertion error)"
      );
    });
    it("should return correct otoken", async () => {
      const shortVault = {
        shortOtokens: [WETH_ADDRESS], // any address
        longOtokens: [],
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(await gammaOperator.getVaultOtokenByVault(shortVault)).to.be.eq(
        WETH_ADDRESS
      );

      const longVault = {
        shortOtokens: [],
        longOtokens: [USDC_ADDRESS], // any address
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(await gammaOperator.getVaultOtokenByVault(longVault)).to.be.eq(
        USDC_ADDRESS
      );

      const longShortVault = {
        shortOtokens: [WETH_ADDRESS], // any address
        longOtokens: [USDC_ADDRESS], // any address
        collateralAssets: [],
        shortAmounts: [],
        longAmounts: [],
        collateralAmounts: [],
      };
      expect(
        await gammaOperator.getVaultOtokenByVault(longShortVault)
      ).to.be.eq(WETH_ADDRESS);
    });
  });

  describe("getVaultOtoken()", async () => {
    it("should revert if there is no long/short otokens in vault", async () => {
      await expectRevert(
        gammaOperator.getVaultOtoken(deployerAddress, 999),
        "reverted with panic code 0x1 (Assertion error)"
      );
    });
    it("should return correct otoken", async () => {
      const shortOptionAmount = parseUnits("1", OTOKEN_DECIMALS);

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
          asset: USDC_ADDRESS,
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

      expect(
        await gammaOperator.getVaultOtoken(sellerAddress, vaultId)
      ).to.be.eq(ethPut.address);
    });
  });

  describe("getOtokenCollateral()", async () => {
    it("should return otoken collateral", async () => {
      const collateral = await ethPut.collateralAsset();
      expect(await gammaOperator.getOtokenCollateral(ethPut.address)).to.be.eq(
        collateral
      );
    });
  });

  describe("getExcessCollateral()", async () => {
    it("should return the same value as Gamma calculator", async () => {
      const vault = {
        shortOtokens: [ethPut.address],
        longOtokens: [],
        collateralAssets: [USDC_ADDRESS],
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

      await setExpiryPriceAndEndDisputePeriod(
        oracle,
        WETH_ADDRESS,
        expiry,
        parseUnits("50", STRIKE_PRICE_DECIMALS)
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
      const ownerAddress = await addressBook.owner();
      const owner = await impersonateAccount(ownerAddress);

      const [funder] = await ethers.getSigners();
      await funder.sendTransaction({
        to: ownerAddress,
        value: parseEther("1"),
      });

      await addressBook.connect(owner).setWhitelist(deployerAddress);
      await addressBook.connect(owner).setMarginCalculator(deployerAddress);

      expect(await gammaOperator.whitelist()).to.not.be.eq(deployerAddress);
      expect(await gammaOperator.calculator()).to.not.be.eq(deployerAddress);

      await gammaOperator.refreshConfig();

      expect(await gammaOperator.whitelist()).to.be.eq(deployerAddress);
      expect(await gammaOperator.calculator()).to.be.eq(deployerAddress);
    });
  });

  describe("harvest()", async () => {
    const amount = parseUnits("1000", USDC_DECIMALS);
    beforeEach(async () => {
      await mintUsdc(amount, gammaOperator.address);
    });
    it("should revert if sender is not owner", async () => {
      await expectRevert(
        gammaOperator
          .connect(buyer)
          .harvest(USDC_ADDRESS, amount, buyerAddress),
        "Ownable: caller is not the owner'"
      );
    });
    it("should revert if amount is wrong", async () => {
      await expectRevert(
        gammaOperator
          .connect(deployer)
          .harvest(USDC_ADDRESS, amount.mul(2), buyerAddress),
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
        .harvest(USDC_ADDRESS, amount, buyerAddress);
      const balanceAfter = await usdc.balanceOf(buyerAddress);
      expect(balanceAfter.sub(balanceBefore)).to.be.eq(amount);
    });
    it("should harvest ETH", async () => {
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
