import { ethers } from "hardhat";
import {
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
  GammaRedeemerV1,
  GammaRedeemerV1__factory,
} from "../typechain";

async function main() {
  const PokeMeAddress = "0x89a26d08c26E00cE935a775Ba74A984Ad346679b";
  const TreasuryAddress = "0x66e2F69df68C8F56837142bE2E8C290EfE76DA9f";
  const GammaAddressBookAddress = "0x1E31F2DCBad4dc572004Eae6355fB18F9615cBe4";

  const GammaRedeemerFactory = (
    await ethers.getContractFactory("GammaRedeemerV1")
  ) as GammaRedeemerV1__factory;
  let gammaRedeemer = (
    await GammaRedeemerFactory.deploy(GammaAddressBookAddress, PokeMeAddress, TreasuryAddress)
  ) as GammaRedeemerV1;

  console.log(gammaRedeemer.address);
  console.log(gammaRedeemer.deployTransaction.hash);
  await gammaRedeemer.deployed();

  const GammaRedeemerResolverFactory = (
    await ethers.getContractFactory("GammaRedeemerResolver")
  ) as GammaRedeemerResolver__factory;
  let resolver = (await GammaRedeemerResolverFactory.deploy(gammaRedeemer.address)) as GammaRedeemerResolver;

  console.log(resolver.address);
  console.log(resolver.deployTransaction.hash);
  await resolver.deployed();
  
  const tx = await gammaRedeemer.startAutomator(resolver.address);
  console.log(tx.hash);

  console.log("FINISHED");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
