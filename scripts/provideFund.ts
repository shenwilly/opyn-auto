import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ETH_TOKEN_ADDRESS } from "../constants/address";
import {
  TaskTreasury
} from "../typechain";

async function main() {
  const TreasuryAddress = "0x66e2F69df68C8F56837142bE2E8C290EfE76DA9f";
  const AutoGammaAddress = "0x3519cfc47c3dbc2f6d916557bd5a4ae96c33b95c"

  const treasury = (await ethers.getContractAt("TaskTreasury", TreasuryAddress)) as TaskTreasury;
  const tx = await treasury.depositFunds(
    AutoGammaAddress, 
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
