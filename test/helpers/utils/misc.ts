import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network } from "hardhat";

export const impersonateAccount = async (
  address: string
): Promise<SignerWithAddress> => {
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });

  return ethers.getSigner(address);
};
