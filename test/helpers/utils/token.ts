import { BigNumberish } from "@ethersproject/bignumber";
import { ethers, network } from "hardhat";
import { USDC_ADDRESS, USDC_WALLET } from "../../../constants/address";

export const mintUsdc = async (amount: BigNumberish, to: string) => {
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [USDC_WALLET],
  });

  const usdcWalletSigner = await ethers.getSigner(USDC_WALLET);
  await usdc.connect(usdcWalletSigner).transfer(to, amount);
};
