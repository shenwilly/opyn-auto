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
} from "../../typechain";
const { time, constants } = require("@openzeppelin/test-helpers");
import { createValidExpiry } from "../helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { setupGammaContracts } from "../helpers/setup/GammaSetup";
import { ActionType } from "../helpers/types/GammaTypes";

const { expect } = chai;
const ZERO_ADDR = constants.ZERO_ADDRESS;

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

  let expiry: number;
  let usdc: MockERC20;
  let weth: MockERC20;

  let ethPut: Otoken;

  const strikePrice = 300;
  const optionsAmount = 10;
  const collateralAmount = optionsAmount * strikePrice;

  let vaultCounter: number;

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

    const now = (await time.latest()).toNumber();
    expiry = createValidExpiry(now, 30);

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

    const vaultCounterBefore = await controller.getAccountVaultCounter(
      sellerAddress
    );
    vaultCounter = vaultCounterBefore.toNumber() + 1;

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemerV1",
      buyer
    )) as GammaRedeemerV1__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(addressBook.address);
  });

  describe("createOrder()", async () => {
    it("Redeem", async () => {});
  });

  describe("cancelOrder()", async () => {
    it("Redeem", async () => {});
  });

  describe("shouldProcessOrder()", async () => {
    it("Redeem", async () => {});
  });

  describe("processOrder()", async () => {
    it("Redeem", async () => {});
  });

  // describe("Redeem", async () => {
  //   const scaledOptionsAmount = parseUnits(
  //     optionsAmount.toString(),
  //     optionDecimals
  //   );
  //   const scaledCollateralAmount = parseUnits(
  //     collateralAmount.toString(),
  //     usdcDecimals
  //   );
  //   const expiryITMSpotPrice = 100;
  //   const expiryOTMSpotPrice = 500;

  //   beforeEach("Open a short put option", async () => {
  //     const actionArgs = [
  //       {
  //         actionType: ActionType.OpenVault,
  //         owner: sellerAddress,
  //         secondAddress: sellerAddress,
  //         asset: ZERO_ADDR,
  //         vaultId: vaultCounter,
  //         amount: "0",
  //         index: "0",
  //         data: ZERO_ADDR,
  //       },
  //       {
  //         actionType: ActionType.MintShortOption,
  //         owner: sellerAddress,
  //         secondAddress: sellerAddress,
  //         asset: ethPut.address,
  //         vaultId: vaultCounter,
  //         amount: scaledOptionsAmount,
  //         index: "0",
  //         data: ZERO_ADDR,
  //       },
  //       {
  //         actionType: ActionType.DepositCollateral,
  //         owner: sellerAddress,
  //         secondAddress: sellerAddress,
  //         asset: usdc.address,
  //         vaultId: vaultCounter,
  //         amount: scaledCollateralAmount,
  //         index: "0",
  //         data: ZERO_ADDR,
  //       },
  //     ];

  //     await controller.connect(seller).operate(actionArgs);
  //     await ethPut.connect(seller).transfer(buyerAddress, scaledOptionsAmount);

  //     vaultCounter++;
  //   });

  //   it("Redeem", async () => {
  //     await ethPut
  //       .connect(buyer)
  //       .approve(gammaRedeemer.address, scaledOptionsAmount);
  //     const tx = await gammaRedeemer
  //       .connect(buyer)
  //       .createOrder(ethPut.address, scaledOptionsAmount, 0);
  //     const receipt = await tx.wait();
  //     const event = receipt.events!.filter(
  //       (event) => event.event == "OrderCreated"
  //     )[0];
  //     const orderId = event.args![0];

  //     if ((await time.latest()) < expiry) {
  //       await time.increaseTo(expiry + 2);
  //     }

  //     const scaledETHPrice = parseUnits(
  //       expiryITMSpotPrice.toString(),
  //       strikePriceDecimals
  //     );
  //     const scaledUSDCPrice = parseUnits("1", strikePriceDecimals);
  //     await oracle.setExpiryPriceFinalizedAllPeiodOver(
  //       weth.address,
  //       expiry,
  //       scaledETHPrice,
  //       true
  //     );
  //     await oracle.setExpiryPriceFinalizedAllPeiodOver(
  //       usdc.address,
  //       expiry,
  //       scaledUSDCPrice,
  //       true
  //     );

  //     expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.true;
  //     console.log((await usdc.balanceOf(buyerAddress)).toString(), "start");
  //     await gammaRedeemer.processOrder(orderId);
  //     console.log((await usdc.balanceOf(buyerAddress)).toString(), "finish");
  //   });

  // it("Should not redeem", async () => {
  //   await ethPut
  //     .connect(buyer)
  //     .approve(gammaRedeemer.address, scaledOptionsAmount);
  //   const tx = await gammaRedeemer
  //     .connect(buyer)
  //     .createOrder(ethPut.address, scaledOptionsAmount, 0);
  //   const receipt = await tx.wait();
  //   const event = receipt.events!.filter(
  //     (event) => event.event == "OrderCreated"
  //   )[0];
  //   const orderId = event.args![0];

  //   if ((await time.latest()) < expiry) {
  //     await time.increaseTo(expiry + 2);
  //   }

  //   const scaledETHPrice = parseUnits(
  //     expiryOTMSpotPrice.toString(),
  //     strikePriceDecimals
  //   );
  //   const scaledUSDCPrice = parseUnits("1", strikePriceDecimals);
  //   await oracle.setExpiryPriceFinalizedAllPeiodOver(
  //     weth.address,
  //     expiry,
  //     scaledETHPrice,
  //     true
  //   );
  //   await oracle.setExpiryPriceFinalizedAllPeiodOver(
  //     usdc.address,
  //     expiry,
  //     scaledUSDCPrice,
  //     true
  //   );

  //   expect(await gammaRedeemer.shouldProcessOrder(orderId)).to.be.false;
  // });
  // });
});
