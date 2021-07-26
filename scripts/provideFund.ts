import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
  PokeMe
} from "../typechain";

async function main() {
  const PokeMeAddress = "0xeC8700A092789F58608212E314e3576bF2E98556";
  const GammaRedeemerAddress = "0xa0EC392636bAD6f8ef163D916c85F9db8d8978A5"

  const automator = (await ethers.getContractAt("PokeMe", PokeMeAddress)) as PokeMe;
  const tx = await automator.depositFunds(GammaRedeemerAddress, {
    value: parseUnits("0.1", "ether")
  })
  console.log(tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
