import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { ADDRESS_BOOK_ADDRESS } from "../../../constants/address";
import {
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
  GammaRedeemerV1,
  GammaRedeemerV1__factory,
  PokeMe,
  TaskTreasury,
} from "../../../typechain";

type AutoGammaContracts = [GammaRedeemerV1, GammaRedeemerResolver];

export const setupAutoGammaContracts = async (
  signer: SignerWithAddress,
  automator: string,
  treasury: string
): Promise<AutoGammaContracts> => {
  const GammaRedeemerFactory = (await ethers.getContractFactory(
    "GammaRedeemerV1",
    signer
  )) as GammaRedeemerV1__factory;
  const gammaRedeemer = await GammaRedeemerFactory.deploy(
    ADDRESS_BOOK_ADDRESS,
    automator,
    treasury
  );

  const ResolverFactory = (await ethers.getContractFactory(
    "GammaRedeemerResolver",
    signer
  )) as GammaRedeemerResolver__factory;
  const resolver = await ResolverFactory.deploy(gammaRedeemer.address);

  return [gammaRedeemer, resolver];
};
