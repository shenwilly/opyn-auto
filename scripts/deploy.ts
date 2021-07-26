import { ethers } from "hardhat";
import {
  GammaRedeemerV1__factory,
} from "../typechain";

async function main() {
  const PokeMeAddress = "0xeC8700A092789F58608212E314e3576bF2E98556";
  const GammaAddressBookAddress = "0xE71417EEfC794C9B83Fc494861981721e26db0E9"

  const GammaRedeemerFactory = (
    await ethers.getContractFactory("GammaRedeemerV1")
  ) as GammaRedeemerV1__factory;

  let gammaRedeemer = await GammaRedeemerFactory.deploy(GammaAddressBookAddress, PokeMeAddress);

  console.log(gammaRedeemer.address);
  console.log(gammaRedeemer.deployTransaction.hash);
  await gammaRedeemer.deployed();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
