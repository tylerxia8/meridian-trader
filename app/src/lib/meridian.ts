// Anchor program client wrapper. Centralizes PDA derivation, account
// resolution, and instruction builders so trade.ts and the UI don't have to
// repeat them.
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import type { Meridian } from "../../../target/types/meridian";

export type Ticker = "AAPL" | "MSFT" | "GOOGL" | "AMZN" | "NVDA" | "META" | "TSLA";

export function tickerBytes(t: Ticker | string): Buffer {
  const b = Buffer.alloc(8);
  Buffer.from(t, "ascii").copy(b, 0, 0, Math.min(t.length, 8));
  return b;
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function marketPda(
  programId: PublicKey,
  ticker: Buffer,
  strikeUsdCents: BN,
  expiryTs: BN
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      ticker,
      strikeUsdCents.toArrayLike(Buffer, "le", 8),
      expiryTs.toArrayLike(Buffer, "le", 8),
    ],
    programId
  )[0];
}

export function yesMintPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("yes"), market.toBuffer()], programId)[0];
}

export function noMintPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("no"), market.toBuffer()], programId)[0];
}

export function vaultPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}

export interface MarketKeys {
  market: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
}

export function deriveMarketKeys(
  programId: PublicKey,
  ticker: string,
  strikeUsdCents: BN,
  expiryTs: BN
): MarketKeys {
  const tb = tickerBytes(ticker);
  const market = marketPda(programId, tb, strikeUsdCents, expiryTs);
  return {
    market,
    yesMint: yesMintPda(programId, market),
    noMint: noMintPda(programId, market),
    vault: vaultPda(programId, market),
  };
}

export interface MeridianClientArgs {
  provider: AnchorProvider;
  program: Program<Meridian>;
  usdcMint: PublicKey;
}

export class MeridianClient {
  readonly provider: AnchorProvider;
  readonly program: Program<Meridian>;
  readonly usdcMint: PublicKey;
  readonly config: PublicKey;

  constructor({ provider, program, usdcMint }: MeridianClientArgs) {
    this.provider = provider;
    this.program = program;
    this.usdcMint = usdcMint;
    this.config = configPda(program.programId);
  }

  /// Build a mint_pair instruction. Caller must ensure the user has ATAs
  /// for USDC, Yes, and No on this market (use ensureAtaInstructions).
  async mintPairIx(
    market: MarketKeys,
    user: PublicKey,
    amount: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .mintPair(amount)
      .accounts({
        user,
        config: this.config,
        market: market.market,
        yesMint: market.yesMint,
        noMint: market.noMint,
        vault: market.vault,
        userUsdc: getAssociatedTokenAddressSync(this.usdcMint, user),
        userYes: getAssociatedTokenAddressSync(market.yesMint, user),
        userNo: getAssociatedTokenAddressSync(market.noMint, user),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  async redeemPairIx(
    market: MarketKeys,
    user: PublicKey,
    amount: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .redeemPair(amount)
      .accounts({
        user,
        config: this.config,
        market: market.market,
        yesMint: market.yesMint,
        noMint: market.noMint,
        vault: market.vault,
        userUsdc: getAssociatedTokenAddressSync(this.usdcMint, user),
        userYes: getAssociatedTokenAddressSync(market.yesMint, user),
        userNo: getAssociatedTokenAddressSync(market.noMint, user),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  async redeemYesIx(
    market: MarketKeys,
    user: PublicKey,
    amount: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .redeemYes(amount)
      .accounts({
        user,
        config: this.config,
        market: market.market,
        yesMint: market.yesMint,
        vault: market.vault,
        userUsdc: getAssociatedTokenAddressSync(this.usdcMint, user),
        userYes: getAssociatedTokenAddressSync(market.yesMint, user),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  async redeemNoIx(
    market: MarketKeys,
    user: PublicKey,
    amount: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .redeemNo(amount)
      .accounts({
        user,
        config: this.config,
        market: market.market,
        noMint: market.noMint,
        vault: market.vault,
        userUsdc: getAssociatedTokenAddressSync(this.usdcMint, user),
        userNo: getAssociatedTokenAddressSync(market.noMint, user),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /// Idempotent ATA creation instructions for USDC, Yes, and No. The frontend
  /// prepends these to the first trade transaction for a market.
  ataIxs(market: MarketKeys, user: PublicKey, payer: PublicKey): TransactionInstruction[] {
    const ata = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, user);
    return [
      anchor.utils.token.createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata(this.usdcMint),
        user,
        this.usdcMint
      ),
      anchor.utils.token.createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata(market.yesMint),
        user,
        market.yesMint
      ),
      anchor.utils.token.createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata(market.noMint),
        user,
        market.noMint
      ),
    ];
  }

  async fetchMarket(market: PublicKey) {
    return this.program.account.market.fetch(market);
  }

  async fetchConfig() {
    return this.program.account.config.fetch(this.config);
  }
}
