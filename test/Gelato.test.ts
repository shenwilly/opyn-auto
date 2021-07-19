import { ethers } from "hardhat";
import chai from "chai";
import {
  Counter__factory,
  Counter,
  GelatoCore,
  GelatoCore__factory,
  GelatoUserProxy,
  ProviderModuleGelatoUserProxy,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import GelatoSetup from "./GelatoSetup";
import { Interface, parseUnits } from "ethers/lib/utils";
import {
  Action,
  GelatoProvider,
  Operation,
  Task,
  TaskReceipt,
  TaskSpec,
} from "./types";
import { CounterInterface } from "../typechain/Counter";
import CounterJSON from "../artifacts/contracts/Counter.sol/Counter.json";

const { expect } = chai;
const { expectRevert } = require("@openzeppelin/test-helpers");

describe("Gelato", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    executor: SignerWithAddress;
  let deployerAddress: string,
    userAddress: string,
    executorAddress: string,
    userProxyAddress: string;

  let gelatoCore: GelatoCore;
  let userProxy: GelatoUserProxy;
  let providerModuleGelatoUserProxy: ProviderModuleGelatoUserProxy;
  let counter: Counter;

  const EXPIRY_DATE = 0;
  const GELATO_GAS_PRICE = parseUnits("9", "gwei");

  before(async () => {
    [deployer, user, executor] = await ethers.getSigners();
    deployerAddress = deployer.address;
    userAddress = user.address;
    executorAddress = executor.address;

    // Deploy Counter
    const CounterFactory = (await ethers.getContractFactory(
      "Counter",
      deployer
    )) as Counter__factory;
    counter = await CounterFactory.deploy();
    await counter.deployed();

    // Deploy Gelato Core with deployer + Stake Executor
    const GelatoCoreFactory = (await ethers.getContractFactory(
      "GelatoCore",
      deployer
    )) as GelatoCore__factory;
    gelatoCore = await GelatoCoreFactory.deploy(GelatoSetup);
    await gelatoCore.deployed();

    await gelatoCore
      .connect(executor)
      .stakeExecutor({ value: parseUnits("1", "ether") });

    // Deploy Gelato Gas Price Oracle with deployer and set to GELATO_GAS_PRICE
    const GelatoGasPriceOracle = await ethers.getContractFactory(
      "GelatoGasPriceOracle",
      deployer
    );
    const gelatoGasPriceOracle = await GelatoGasPriceOracle.deploy(
      GELATO_GAS_PRICE
    );
    await gelatoGasPriceOracle.deployed();

    // Set gas price oracle on core
    await gelatoCore
      .connect(deployer)
      .setGelatoGasPriceOracle(gelatoGasPriceOracle.address);

    // Deploy GelatoUserProxyFactory with deployer
    const GelatoUserProxyFactory = await ethers.getContractFactory(
      "GelatoUserProxyFactory",
      deployer
    );
    const gelatoUserProxyFactory = await GelatoUserProxyFactory.deploy(
      gelatoCore.address
    );
    await gelatoUserProxyFactory.deployed();

    const GelatoActionPipeline = await ethers.getContractFactory(
      "GelatoActionPipeline",
      deployer
    );
    const gelatoActionPipeline = await GelatoActionPipeline.deploy();
    await gelatoActionPipeline.deployed();

    // Deploy ProviderModuleGelatoUserProxy with constructorArgs
    const ProviderModuleGelatoUserProxy = await ethers.getContractFactory(
      "ProviderModuleGelatoUserProxy",
      deployer
    );
    providerModuleGelatoUserProxy = (await ProviderModuleGelatoUserProxy.deploy(
      gelatoUserProxyFactory.address,
      gelatoActionPipeline.address
    )) as ProviderModuleGelatoUserProxy;
    await providerModuleGelatoUserProxy.deployed();

    // Create UserProxy
    const createTx = await gelatoUserProxyFactory.connect(user).create();
    await createTx.wait();
    [userProxyAddress] = await gelatoUserProxyFactory.gelatoProxiesByUser(
      userAddress
    );
    userProxy = (await ethers.getContractAt(
      "GelatoUserProxy",
      userProxyAddress
    )) as GelatoUserProxy;

    // Call provideFunds(value) with provider on core
    await gelatoCore.connect(user).provideFunds(userAddress, {
      value: ethers.utils.parseUnits("1", "ether"),
    });

    const counterInterface = new ethers.utils.Interface(
      CounterJSON.abi
    ) as CounterInterface;
    const action = new Action({
      addr: counter.address,
      data: counterInterface.encodeFunctionData("countUp"),
      operation: Operation.Call,
      // termsOkCheck: true,
    });

    const newTaskSpec = new TaskSpec({
      actions: [action],
      gasPriceCeil: ethers.utils.parseUnits("20", "gwei"),
    });

    await gelatoCore
      .connect(user)
      .multiProvide(
        executorAddress,
        [newTaskSpec],
        [providerModuleGelatoUserProxy.address]
      );
  });

  describe("Submit Task", async () => {
    it("should submit task", async () => {
      const counterInterface = new ethers.utils.Interface(
        CounterJSON.abi
      ) as CounterInterface;

      const action = new Action({
        addr: counter.address,
        data: counterInterface.encodeFunctionData("countUp"),
        operation: Operation.Call,
        // termsOkCheck: true,
      });

      const task = new Task({
        actions: [action],
      });

      // Submit Task
      const gelatoProvider = new GelatoProvider({
        addr: userAddress,
        module: providerModuleGelatoUserProxy.address,
      });

      let taskReceipt = new TaskReceipt({
        id: 1,
        userProxy: userProxyAddress,
        provider: gelatoProvider,
        tasks: [task],
        submissionsLeft: 1,
      });

      await expect(
        userProxy.connect(user).submitTask(gelatoProvider, task, EXPIRY_DATE)
      ).to.emit(gelatoCore, "LogTaskSubmitted");

      const countBefore = await counter.getCount();
      console.log(countBefore.toString());

      const tx = await gelatoCore.connect(executor).exec(taskReceipt, {
        gasPrice: GELATO_GAS_PRICE,
        gasLimit: 300000,
      });
      const receipt = await tx.wait();
      // console.log(receipt.events);

      const countAfter = await counter.getCount();
      console.log(countAfter.toString());
    });
  });

  // describe("count down", async () => {
  // it("should revert", async () => {
  //   await expectRevert(counter.countDown(), "Uint256 underflow");
  // });
  // });
});
