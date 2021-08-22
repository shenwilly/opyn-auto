import { ethers } from "hardhat";
import { UNISWAP_V2_ROUTER_02 } from "../constants/address";
import {
  AutoGammaResolver,
  AutoGammaResolver__factory,
  AutoGamma,
  AutoGamma__factory,
} from "../typechain";

async function main() {
  const PokeMeAddress = "0x89a26d08c26E00cE935a775Ba74A984Ad346679b";
  const TreasuryAddress = "0x66e2F69df68C8F56837142bE2E8C290EfE76DA9f";
  const GammaAddressBookAddress = "0x1E31F2DCBad4dc572004Eae6355fB18F9615cBe4";

  const AutoGammaFactory = (
    await ethers.getContractFactory("AutoGamma")
  ) as AutoGamma__factory;
  let autoGamma = (
    await AutoGammaFactory.deploy(GammaAddressBookAddress, UNISWAP_V2_ROUTER_02, PokeMeAddress, TreasuryAddress)
  ) as AutoGamma;

  console.log(autoGamma.address);
  console.log(autoGamma.deployTransaction.hash);
  await autoGamma.deployed();

  const AutoGammaResolverFactory = (
    await ethers.getContractFactory("AutoGammaResolver")
  ) as AutoGammaResolver__factory;
  let resolver = (await AutoGammaResolverFactory.deploy(autoGamma.address, UNISWAP_V2_ROUTER_02)) as AutoGammaResolver;

  console.log(resolver.address);
  console.log(resolver.deployTransaction.hash);
  await resolver.deployed();
  
  const tx = await autoGamma.startAutomator(resolver.address);
  console.log(tx.hash);

  console.log("FINISHED");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
