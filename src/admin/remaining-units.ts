export function isValidRemainingUnits(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0);
}

export function parseRemainingUnitsInput(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const remainingUnits = Number(value);
  return isValidRemainingUnits(remainingUnits) ? remainingUnits : undefined;
}
