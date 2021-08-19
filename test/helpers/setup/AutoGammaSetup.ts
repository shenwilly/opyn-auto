import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  ADDRESS_BOOK_ADDRESS,
  UNISWAP_V2_ROUTER_02,
} from "../../../constants/address";
import {
  GammaRedeemerResolver,
  GammaRedeemerResolver__factory,
  GammaRedeemerV1,
  GammaRedeemerV1__factory,
} from "../../../typechain";

type AutoGammaContracts = [GammaRedeemerV1, GammaRedeemerResolver];

export const setupAutoGammaContracts = async (
  signer: SignerWithAddress,
  uniRouter: string,
  automator: string,
  treasury: string
): Promise<AutoGammaContracts> => {
  const GammaRedeemerFactory = (await ethers.getContractFactory(
    "GammaRedeemerV1",
    signer
  )) as GammaRedeemerV1__factory;
  const gammaRedeemer = await GammaRedeemerFactory.deploy(
    ADDRESS_BOOK_ADDRESS,
    uniRouter,
    automator,
    treasury
  );

  const ResolverFactory = (await ethers.getContractFactory(
    "GammaRedeemerResolver",
    signer
  )) as GammaRedeemerResolver__factory;
  const resolver = await ResolverFactory.deploy(
    gammaRedeemer.address,
    UNISWAP_V2_ROUTER_02
  );

  return [gammaRedeemer, resolver];
};
