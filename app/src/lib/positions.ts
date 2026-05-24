// Position-constraint helper.
//
// Rule (PRD §"Position Constraints"): a user holding No tokens for strike S
// cannot Buy Yes for S without first closing their No position, and vice
// versa. This is enforced UX-side because the on-chain program treats both
// tokens equally — holding both is fine ($1 of redeemable USDC), but it
// shouldn't be the result of a trade action.
//
// Holding both is only acceptable as a transient state inside Buy-No
// (mint + sell-Yes in one tx).

export type Side = "yes" | "no";

export type AllowedAction = "buyYes" | "sellYes" | "buyNo" | "sellNo";

export interface UserBalances {
  yes: bigint;
  no: bigint;
}

export interface AllowedActionsResult {
  allowed: AllowedAction[];
  /// If non-null, the UI should show this message instead of trade buttons.
  guidance: string | null;
}

/// Returns the set of actions the user is allowed to take given their
/// current Yes/No balances on a strike, plus optional guidance text for the
/// UI to display.
export function allowedActions(balances: UserBalances): AllowedActionsResult {
  const hasYes = balances.yes > 0n;
  const hasNo = balances.no > 0n;

  // Neither side held: any action available.
  if (!hasYes && !hasNo) {
    return { allowed: ["buyYes", "buyNo"], guidance: null };
  }

  // Holds Yes only: can sell Yes (exit) or buy more Yes (add). Buying No
  // is blocked — close the Yes position first.
  if (hasYes && !hasNo) {
    return {
      allowed: ["buyYes", "sellYes"],
      guidance: null,
    };
  }

  // Holds No only: can sell No (exit) or buy more No (add). Buying Yes
  // is blocked.
  if (!hasYes && hasNo) {
    return {
      allowed: ["buyNo", "sellNo"],
      guidance: null,
    };
  }

  // Holds both Yes AND No: shouldn't normally happen via trading, but if
  // it does (e.g. user minted a pair manually), prompt them to redeem the
  // matched portion first.
  return {
    allowed: [],
    guidance: "You hold both Yes and No tokens. Redeem the matched pair for USDC before trading.",
  };
}
