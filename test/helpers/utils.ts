export const createValidExpiry = (now: number, days: number) => {
  const multiplier = (now - 28800) / 86400;
  return (Number(multiplier.toFixed(0)) + 1) * 86400 + days * 86400 + 28800;
};
