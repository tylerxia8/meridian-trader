export function solanaExplorerAccountUrl(address: string, kind: "address" | "tx" = "address"): string {
  return `https://explorer.solana.com/${kind}/${address}?cluster=devnet`;
}
