import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  activeMarketError,
  linkedPhoenixMarketError,
  marketKeysFor,
  outcomeName,
} from "./meridian";
import { vaultPda } from "@/lib/meridian";

test("outcomeName decodes Anchor enum objects", () => {
  assert.equal(outcomeName({ unsettled: {} }), "unsettled");
  assert.equal(outcomeName({ yesWins: {} }), "yesWins");
  assert.equal(outcomeName({ noWins: {} }), "noWins");
  assert.equal(outcomeName(null), "unsettled");
});

test("activeMarketError rejects settled and expired markets", () => {
  assert.equal(activeMarketError({ outcome: { yesWins: {} }, expiryTs: 200 }, 100), "Market is already settled");
  assert.equal(
    activeMarketError({ outcome: { unsettled: {} }, expiryTs: 100 }, 100),
    "Market is expired and waiting for settlement"
  );
  assert.equal(activeMarketError({ outcome: { unsettled: {} }, expiryTs: 101 }, 100), null);
});

test("linkedPhoenixMarketError validates linked Phoenix market", () => {
  const linked = new PublicKey("H7SydVtJfV9Pms51891Y8KHTayEFKxpwAtsVXcoNKxJw");
  const other = new PublicKey("9DdGPbFA8wxyzduRwbrKFMNVLRBQndXdGs52mXi9LDLy");

  assert.equal(linkedPhoenixMarketError({ phoenixMarket: PublicKey.default }, linked), "Market is not linked to a Phoenix book");
  assert.equal(
    linkedPhoenixMarketError({ phoenixMarket: linked }, other),
    "Phoenix market does not match the selected Meridian market"
  );
  assert.equal(linkedPhoenixMarketError({ phoenixMarket: linked }, linked), null);
});

test("marketKeysFor trusts market mints and derives vault PDA", () => {
  const programId = new PublicKey("6SaMPmMDFZD6pg4NwK13Cph6YSSiZQwzBsbhrroRUJdy");
  const market = new PublicKey("H1ZiBSSHoYq3MSyRYfcdXwR8QKe2UBd3iTiuSZVKPjVk");
  const yesMint = new PublicKey("11111111111111111111111111111112");
  const noMint = new PublicKey("11111111111111111111111111111113");
  const keys = marketKeysFor(programId, market, { yesMint, noMint });

  assert.equal(keys.market.toBase58(), market.toBase58());
  assert.equal(keys.yesMint.toBase58(), yesMint.toBase58());
  assert.equal(keys.noMint.toBase58(), noMint.toBase58());
  assert.equal(keys.vault.toBase58(), vaultPda(programId, market).toBase58());
});
