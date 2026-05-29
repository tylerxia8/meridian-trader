export type SettlementFailureKind = "oracleStale" | "oracleConfTooWide" | "transport" | "hard";

export function classifySettlementError(message: string): SettlementFailureKind {
  if (/OracleStale/i.test(message)) return "oracleStale";
  if (/OracleConfTooWide/i.test(message)) return "oracleConfTooWide";
  if (/connection|timeout|429|rate limit|temporar/i.test(message)) return "transport";
  return "hard";
}
