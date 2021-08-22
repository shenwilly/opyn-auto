import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  ADDRESS_BOOK_ADDRESS,
  UNISWAP_V2_ROUTER_02,
} from "../../../constants/address";
import {
  AutoGammaResolver,
  AutoGammaResolver__factory,
  AutoGamma,
  AutoGamma__factory,
} from "../../../typechain";

type AutoGammaContracts = [AutoGamma, AutoGammaResolver];

export const setupAutoGammaContracts = async (
  signer: SignerWithAddress,
  uniRouter: string,
  automator: string,
  treasury: string
): Promise<AutoGammaContracts> => {
  const AutoGammaFactory = (await ethers.getContractFactory(
    "AutoGamma",
    signer
  )) as AutoGamma__factory;
  const autoGamma = await AutoGammaFactory.deploy(
    ADDRESS_BOOK_ADDRESS,
    uniRouter,
    automator,
    treasury
  );

  const ResolverFactory = (await ethers.getContractFactory(
    "AutoGammaResolver",
    signer
  )) as AutoGammaResolver__factory;
  const resolver = await ResolverFactory.deploy(
    autoGamma.address,
    UNISWAP_V2_ROUTER_02
  );

  return [autoGamma, resolver];
};
