// Experimental Phoenix Legacy market creation for a Meridian Yes/USDC pair.
//
// Required env:
//   MERIDIAN_MARKET=<Meridian Market account pubkey>
//
// Optional env:
//   PHOENIX_BIDS_SIZE=512
//   PHOENIX_ASKS_SIZE=512
//   PHOENIX_NUM_SEATS=128
//   PHOENIX_QUOTE_LOTS_PER_QUOTE_UNIT=10000   # quote lot = 0.0001 USDC when quote has 6 decimals
//   PHOENIX_BASE_LOTS_PER_BASE_UNIT=100       # base lot = 0.01 Yes when base has 6 decimals
//   PHOENIX_TICK_SIZE_IN_QUOTE_LOTS_PER_BASE_UNIT=100 # 0.01 USDC tick with defaults
//   PHOENIX_TAKER_FEE_BPS=0
//
// It creates the Phoenix market account, initializes it, then calls
// Meridian.link_phoenix_market. The initialize account order and params mirror
// phoenix-common's create_initialize_market_instruction.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  getLogAuthority,
  initializeParamsBeet,
  PROGRAM_ID as PHOENIX_PROGRAM_ID,
} from "@ellipsis-labs/phoenix-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";

type MarketSizeParams = {
  bidsSize: number;
  asksSize: number;
  numSeats: number;
};

async function main(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const admin = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("ANCHOR_WALLET")));
  const meridianMarket = new PublicKey(requiredEnv("MERIDIAN_MARKET"));
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const meridian = new Program(idl, provider) as Program;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], meridian.programId)[0];
  const marketAccount = await (meridian.account as any).market.fetch(meridianMarket);
  const configAccount = await (meridian.account as any).config.fetch(config);
  const yesMint: PublicKey = marketAccount.yesMint;
  const quoteMint: PublicKey = configAccount.usdcMint;
  const phoenixMarket = Keypair.generate();
  const sizeParams = {
    bidsSize: envNumber("PHOENIX_BIDS_SIZE", 512),
    asksSize: envNumber("PHOENIX_ASKS_SIZE", 512),
    numSeats: envNumber("PHOENIX_NUM_SEATS", 128),
  };
  const marketSpace = phoenixMarketSpace(sizeParams);
  const lamports = await connection.getMinimumBalanceForRentExemption(marketSpace);

  console.log(`[phoenix:create] Meridian market: ${meridianMarket.toBase58()}`);
  console.log(`[phoenix:create] Yes mint: ${yesMint.toBase58()}`);
  console.log(`[phoenix:create] Quote mint: ${quoteMint.toBase58()}`);
  console.log(`[phoenix:create] Phoenix market: ${phoenixMarket.publicKey.toBase58()}`);
  console.log(`[phoenix:create] Space ${marketSpace} bytes; rent ${lamports} lamports`);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: phoenixMarket.publicKey,
      lamports,
      space: marketSpace,
      programId: PHOENIX_PROGRAM_ID,
    }),
    createInitializePhoenixMarketIx({
      market: phoenixMarket.publicKey,
      baseMint: yesMint,
      quoteMint,
      marketCreator: admin.publicKey,
      feeCollector: admin.publicKey,
      marketSizeParams: sizeParams,
      numQuoteLotsPerQuoteUnit: envNumber("PHOENIX_QUOTE_LOTS_PER_QUOTE_UNIT", 10000),
      numBaseLotsPerBaseUnit: envNumber("PHOENIX_BASE_LOTS_PER_BASE_UNIT", 100),
      tickSizeInQuoteLotsPerBaseUnit: envNumber("PHOENIX_TICK_SIZE_IN_QUOTE_LOTS_PER_BASE_UNIT", 100),
      takerFeeBps: envNumber("PHOENIX_TAKER_FEE_BPS", 0),
    })
  );
  await sendAndConfirmTransaction(connection, tx, [admin, phoenixMarket], { commitment: "confirmed" });

  console.log("[phoenix:create] Linking Phoenix market into Meridian");
  await meridian.methods
    .linkPhoenixMarket(phoenixMarket.publicKey)
    .accounts({
      admin: admin.publicKey,
      config,
      market: meridianMarket,
    })
    .rpc();

  console.log(`[phoenix:create] Linked ${phoenixMarket.publicKey.toBase58()}`);
}

function createInitializePhoenixMarketIx(args: {
  market: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  marketCreator: PublicKey;
  feeCollector: PublicKey;
  marketSizeParams: MarketSizeParams;
  numQuoteLotsPerQuoteUnit: number;
  numBaseLotsPerBaseUnit: number;
  tickSizeInQuoteLotsPerBaseUnit: number;
  takerFeeBps: number;
}): TransactionInstruction {
  const baseVault = getVaultAddress(args.market, args.baseMint);
  const quoteVault = getVaultAddress(args.market, args.quoteMint);
  const [paramsData] = initializeParamsBeet.serialize({
    marketSizeParams: args.marketSizeParams,
    numQuoteLotsPerQuoteUnit: args.numQuoteLotsPerQuoteUnit,
    tickSizeInQuoteLotsPerBaseUnit: args.tickSizeInQuoteLotsPerBaseUnit,
    numBaseLotsPerBaseUnit: args.numBaseLotsPerBaseUnit,
    takerFeeBps: args.takerFeeBps,
    feeCollector: args.feeCollector,
    rawBaseUnitsPerBaseUnit: null,
  });
  const data = Buffer.concat([Buffer.from([100]), paramsData]);

  return new TransactionInstruction({
    programId: PHOENIX_PROGRAM_ID,
    keys: [
      { pubkey: PHOENIX_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: getLogAuthority(), isSigner: false, isWritable: false },
      { pubkey: args.market, isSigner: false, isWritable: true },
      { pubkey: args.marketCreator, isSigner: true, isWritable: true },
      { pubkey: args.baseMint, isSigner: false, isWritable: false },
      { pubkey: args.quoteMint, isSigner: false, isWritable: false },
      { pubkey: baseVault, isSigner: false, isWritable: true },
      { pubkey: quoteVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function getVaultAddress(market: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer(), mint.toBuffer()],
    PHOENIX_PROGRAM_ID
  )[0];
}

function phoenixMarketSpace(params: MarketSizeParams): number {
  const header = 576;
  const fixedFifo = 256 + 6 * 8;
  const redBlackHeader = 32;
  const orderNode = 16 + 16 + 32;
  const traderNode = 16 + 32 + 96;
  return (
    header +
    fixedFifo +
    redBlackHeader +
    orderNode * params.bidsSize +
    redBlackHeader +
    orderNode * params.asksSize +
    redBlackHeader +
    traderNode * params.numSeats
  );
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function envNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric env var ${key}: ${value}`);
  return parsed;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
