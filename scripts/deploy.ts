import { ethers } from "hardhat";
import {
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
  GammaRedeemerV1,
  GammaRedeemerV1__factory,
} from "../typechain";

async function main() {
  const PokeMeAddress = "0x53638DFef84aAA6AAbA70F948d39d00001771d99";
  const TreasuryAddress = "0x2705aCca70CdB3E326C1013eEA2c03A4f2935b66";
  const GammaAddressBookAddress = "0xE71417EEfC794C9B83Fc494861981721e26db0E9";

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
