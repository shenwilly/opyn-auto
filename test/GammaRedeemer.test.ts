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
  GammaRedeemer,
  MockERC20__factory,
  GammaRedeemer__factory,
} from "../typechain";
import { ContractFactory } from "ethers";
const { time, constants } = require("@openzeppelin/test-helpers");
import { createValidExpiry } from "./helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";

enum ActionType {
  OpenVault,
  MintShortOption,
  BurnShortOption,
  DepositLongOption,
  WithdrawLongOption,
  DepositCollateral,
  WithdrawCollateral,
  SettleVault,
  Redeem,
  Call,
}

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
  let controllerProxy: Controller;
  let gammaRedeemer: GammaRedeemer;

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

    // deploy AddressBook
    const AddressBookFactory: ContractFactory = await ethers.getContractFactory(
      "AddressBook"
    );
    addressBook = (await AddressBookFactory.deploy()) as AddressBook;

    // deploy OtokenFactory & set address
    const OtokenFactoryFactory: ContractFactory =
      await ethers.getContractFactory("OtokenFactory");
    otokenFactory = (await OtokenFactoryFactory.deploy(
      addressBook.address
    )) as OtokenFactory;
    await addressBook.setOtokenFactory(otokenFactory.address);

    // deploy Otoken implementation & set address
    const OtokenFactory: ContractFactory = await ethers.getContractFactory(
      "Otoken"
    );
    const oTokenImplementation = await OtokenFactory.deploy();
    await addressBook.setOtokenImpl(oTokenImplementation.address);

    // deploy Whitelist module & set address
    const WhitelistFactory: ContractFactory = await ethers.getContractFactory(
      "Whitelist"
    );
    whitelist = (await WhitelistFactory.deploy(
      addressBook.address
    )) as Whitelist;
    await addressBook.setWhitelist(whitelist.address);

    // deploy Oracle module & set address
    const OracleFactory: ContractFactory = await ethers.getContractFactory(
      "MockOracle"
    );
    oracle = (await OracleFactory.deploy()) as MockOracle;
    await addressBook.setOracle(oracle.address);

    // deploy MarginPool module & set address
    const MarginPoolFactory: ContractFactory = await ethers.getContractFactory(
      "MarginPool"
    );
    marginPool = (await MarginPoolFactory.deploy(
      addressBook.address
    )) as MarginPool;
    await addressBook.setMarginPool(marginPool.address);

    // deploy MarginCalculator module & set address
    const MarginCalculatorFactory: ContractFactory =
      await ethers.getContractFactory("MarginCalculator");
    calculator = (await MarginCalculatorFactory.deploy(
      oracle.address
    )) as MarginCalculator;
    await addressBook.setMarginCalculator(calculator.address);

    // deploy MarginVault library
    const MarginVaultFactory: ContractFactory = await ethers.getContractFactory(
      "MarginVault"
    );
    const marginVault = await MarginVaultFactory.deploy();

    // deploy Controller & set address
    const ControllerFactory: ContractFactory = await ethers.getContractFactory(
      "Controller",
      {
        libraries: {
          MarginVault: marginVault.address,
        },
      }
    );
    const controller = (await ControllerFactory.deploy()) as Controller;
    await addressBook.setController(controller.address);

    let controllerAddress = await addressBook.getController();
    controllerProxy = (await ethers.getContractAt(
      "Controller",
      controllerAddress
    )) as Controller;

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

    //deploy Uniswap V2
    // const UniswapV2Factory = await ethers.getContractFactory(
    //   [
    //     "constructor(address _feeToSetter)",
    //     "function createPair(address tokenA, address tokenB) external returns (address pair)",
    //   ],
    //   UniswapV2FactoryBytecode
    // );
    // const uniswapV2Factory = (await UniswapV2Factory.deploy(sellerAddress)) as  UniswapV2Factory;
    // uniswapV2Factory.createPair(usdc.address, weth.address)

    // const UniswapRouterFactory = (await ethers.getContractFactory('UniswapV2Router02')) as UniswapV2Router02__factory
    // const uniswapRouter = (await UniswapRouterFactory.deploy(uniswapV2Factory.address, weth.address)) as UniswapV2Router02

    // const liquidityAmountUsdc = createTokenAmount(100, usdcDecimals)
    // const liquidityAmountWeth = createTokenAmount(100, wethDecimals)
    // const liquidityAmountMin = createTokenAmount(10, wethDecimals)

    // usdc.connect(deployer);
    // await usdc.mint(deployerAddress, liquidityAmountUsdc)
    // weth.connect(deployer);
    // await weth.mint(deployerAddress, liquidityAmountWeth)

    // await uniswapRouter.addLiquidity(
    //   weth.address,
    //   usdc.address,
    //   liquidityAmountUsdc,
    //   liquidityAmountWeth,
    //   liquidityAmountMin,
    //   liquidityAmountMin,
    //   deployerAddress,
    //   100
    // )

    // deploy Vault Operator
    const GammaRedeemerFactory = (await ethers.getContractFactory(
      "GammaRedeemer",
      buyer
    )) as GammaRedeemer__factory;
    gammaRedeemer = await GammaRedeemerFactory.deploy(addressBook.address);
  });

  describe("Redeem", async () => {
    const scaledOptionsAmount = parseUnits(
      optionsAmount.toString(),
      optionDecimals
    );
    const scaledCollateralAmount = parseUnits(
      collateralAmount.toString(),
      usdcDecimals
    );
    const expirySpotPrice = 100;

    beforeEach("Open a short put option", async () => {
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: "0",
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: ethPut.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: "0",
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: sellerAddress,
          secondAddress: sellerAddress,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledCollateralAmount,
          index: "0",
          data: ZERO_ADDR,
        },
      ];

      await controllerProxy.connect(seller).operate(actionArgs);
      await ethPut.connect(seller).transfer(buyerAddress, scaledOptionsAmount);
    });

    it("Redeem", async () => {
      await ethPut
        .connect(buyer)
        .approve(gammaRedeemer.address, scaledOptionsAmount);
      const tx = await gammaRedeemer
        .connect(buyer)
        .createAutoRedeemOrder(ethPut.address, scaledOptionsAmount);
      const receipt = await tx.wait();
      const event = receipt.events!.filter(
        (event) => event.event == "AutoRedeemOrderCreated"
      )[0];
      const orderId = event.args![0];
      console.log(orderId.toString(), "!?");

      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2);
      }

      const scaledETHPrice = parseUnits(
        expirySpotPrice.toString(),
        strikePriceDecimals
      );
      const scaledUSDCPrice = parseUnits("1", strikePriceDecimals);
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        expiry,
        scaledETHPrice,
        true
      );
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        usdc.address,
        expiry,
        scaledUSDCPrice,
        true
      );

      console.log((await usdc.balanceOf(buyerAddress)).toString(), "start");
      await gammaRedeemer.redeem(orderId);
      console.log((await usdc.balanceOf(buyerAddress)).toString(), "finish");
    });
  });
});
