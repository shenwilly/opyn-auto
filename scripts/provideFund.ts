import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ETH_TOKEN_ADDRESS } from "../constants/constants";
import {
  TaskTreasury
} from "../typechain";

async function main() {
  const TreasuryAddress = "0x66e2F69df68C8F56837142bE2E8C290EfE76DA9f";
  const GammaRedeemerAddress = "0xCD92f7bd79e5b0f7D0E20fE7eFDf3FafB70e3904"

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
