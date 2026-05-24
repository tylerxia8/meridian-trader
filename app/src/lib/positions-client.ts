// Pure client copy of positions.ts. Kept here so the React tree doesn't need
// to import the @solana-loaded lib/positions.ts file (which is also safe but
// dragged in extra deps). If you'd rather not duplicate, switch the imports.
export type AllowedAction = "buyYes" | "sellYes" | "buyNo" | "sellNo";

export interface UserBalances {
  yes: bigint;
  no: bigint;
}

export interface AllowedActionsResult {
  allowed: AllowedAction[];
  guidance: string | null;
}

export function allowedActions(balances: UserBalances): AllowedActionsResult {
  const hasYes = balances.yes > 0n;
  const hasNo = balances.no > 0n;
  if (!hasYes && !hasNo) return { allowed: ["buyYes", "buyNo"], guidance: null };
  if (hasYes && !hasNo) return { allowed: ["buyYes", "sellYes"], guidance: null };
  if (!hasYes && hasNo) return { allowed: ["buyNo", "sellNo"], guidance: null };
  return {
    allowed: [],
    guidance: "You hold both Yes and No tokens. Redeem the matched pair for USDC before trading.",
  };
}
