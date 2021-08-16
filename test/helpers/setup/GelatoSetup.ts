import { ethers } from "hardhat";
import { POKEME_ADDRESS, TREASURY_ADDRESS } from "../../../constants/address";
import { PokeMe, TaskTreasury } from "../../../typechain";

type GelatoContracts = [PokeMe, TaskTreasury];

export const setupGelatoContracts = async (): Promise<GelatoContracts> => {
  const treasury = (await ethers.getContractAt(
    "TaskTreasury",
    TREASURY_ADDRESS
  )) as TaskTreasury;

  const automator = (await ethers.getContractAt(
    "PokeMe",
    POKEME_ADDRESS
  )) as PokeMe;

  return [automator, treasury];
};
