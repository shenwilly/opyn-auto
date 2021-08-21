import { GammaRedeemerV1 } from "../../../typechain";

export const setUniPair = async (
  gammaRedeemer: GammaRedeemerV1,
  token1: string,
  token2: string,
  value: boolean
) => {
  const isAllowed = await gammaRedeemer.uniPair(token1, token2);
  if (value === true && isAllowed === false) {
    await gammaRedeemer.allowPair(token1, token2);
  } else if (value === false && isAllowed === true) {
    await gammaRedeemer.disallowPair(token1, token2);
  }
};
