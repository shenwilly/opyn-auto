import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ETH_TOKEN_ADDRESS } from "../test/helpers/constants";
import {
  TaskTreasury
} from "../typechain";

async function main() {
  const TreasuryAddress = "0x2705aCca70CdB3E326C1013eEA2c03A4f2935b66";
  const GammaRedeemerAddress = "0xD124F6De09EC929EeCFffbcee4f38D226592Acdb"

  const treasury = (await ethers.getContractAt("TaskTreasury", TreasuryAddress)) as TaskTreasury;
  const tx = await treasury.depositFunds(
    GammaRedeemerAddress, 
    ETH_TOKEN_ADDRESS,
    0,
    {
      value: parseUnits("0.1", "ether"),
    }
  );
  console.log(tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
