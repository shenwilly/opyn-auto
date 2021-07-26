import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
  GammaRedeemerV1,
  Otoken,
} from "../typechain";

async function main() {
  const GammaRedeemerAddress = "0xa0EC392636bAD6f8ef163D916c85F9db8d8978A5"
  const otokenAddress = ""
  const amount = parseUnits("1", "8");

  const otoken = (await ethers.getContractAt("Otoken", otokenAddress)) as Otoken;
  
  await otoken.approve(GammaRedeemerAddress, amount);

  const gammaRedeemer = (await ethers.getContractAt("GammaRedeemerV1", GammaRedeemerAddress)) as GammaRedeemerV1;
  
  const tx = await gammaRedeemer.createOrder(otokenAddress, amount, 0);
  console.log(tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
