import { ethers } from "hardhat";
import {
  Controller,
  GammaRedeemerV1,
} from "../typechain";

async function main() {
  const GammaRedeemerAddress = "0xa0EC392636bAD6f8ef163D916c85F9db8d8978A5"
  const otokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

  const gammaRedeemer = (await ethers.getContractAt("GammaRedeemerV1", GammaRedeemerAddress)) as GammaRedeemerV1;
  const controllerAddress = await gammaRedeemer.controller();
  const controller = (await ethers.getContractAt("Controller", controllerAddress)) as Controller;

  await controller.setOperator(GammaRedeemerAddress, true);
  
  const tx = await gammaRedeemer.createOrder(otokenAddress, 0, 1);
  console.log(tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
