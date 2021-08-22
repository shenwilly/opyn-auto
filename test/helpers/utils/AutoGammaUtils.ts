import { AutoGamma } from "../../../typechain";

export const setUniPair = async (
  autoGamma: AutoGamma,
  token1: string,
  token2: string,
  value: boolean
) => {
  const isAllowed = await autoGamma.uniPair(token1, token2);
  if (value === true && isAllowed === false) {
    await autoGamma.allowPair(token1, token2);
  } else if (value === false && isAllowed === true) {
    await autoGamma.disallowPair(token1, token2);
  }
};
