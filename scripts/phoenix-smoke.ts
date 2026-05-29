// Phoenix linked-book smoke test.
//
// Required env:
//   MERIDIAN_MARKET=<Meridian Market account pubkey>
//
// The admin wallet must hold at least PHOENIX_SMOKE_USDC_UNITS demo USDC in
// its associated token account. The script mints a matched Meridian pair, uses
// the YES token as Phoenix base inventory, places a tiny ask, and verifies it
// appears on the linked Phoenix book.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
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

const DEFAULT_PUBKEY = PublicKey.default.toBase58();
const USDC_DECIMALS = 6;
const ONE_USDC = 10n ** BigInt(USDC_DECIMALS);

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

  const phoenixMarket = marketAccount.phoenixMarket as PublicKey;
  if (!phoenixMarket || phoenixMarket.toBase58() === DEFAULT_PUBKEY) {
    throw new Error("Meridian market is not linked to a Phoenix market. Run phoenix:create or phoenix:link first.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(marketAccount.expiryTs);
  if (expiry <= now) {
    throw new Error(`Meridian market is expired (${expiry}); create/link a fresh market before trading.`);
  }

  const yesMint = marketAccount.yesMint as PublicKey;
  const noMint = marketAccount.noMint as PublicKey;
  const vault = marketAccount.vault as PublicKey;
  const usdcMint = configAccount.usdcMint as PublicKey;
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, admin.publicKey);
  const userYes = getAssociatedTokenAddressSync(yesMint, admin.publicKey);
  const userNo = getAssociatedTokenAddressSync(noMint, admin.publicKey);

  const smokeUsdcUnits = BigInt(envNumber("PHOENIX_SMOKE_USDC_UNITS", 1));
  const mintAmount = smokeUsdcUnits * ONE_USDC;
  const price = envNumber("PHOENIX_SMOKE_ASK_PRICE", 0.60);
  const sizeBaseUnits = envNumber("PHOENIX_SMOKE_SIZE_BASE_UNITS", 0.01);
  const requiredBaseAtoms = BigInt(Math.round(sizeBaseUnits * 10 ** 6));

  console.log(`[phoenix:smoke] Meridian market: ${meridianMarket.toBase58()}`);
  console.log(`[phoenix:smoke] Phoenix market: ${phoenixMarket.toBase58()}`);
  console.log(`[phoenix:smoke] Admin: ${admin.publicKey.toBase58()}`);

  const setupAtaTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userUsdc, admin.publicKey, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userYes, admin.publicKey, yesMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userNo, admin.publicKey, noMint)
  );
  await sendAndConfirmTransaction(connection, setupAtaTx, [admin], { commitment: "confirmed" });

  const phoenixClient = await Phoenix.Client.createWithMarketAddresses(
    connection,
    process.env.PHOENIX_ENDPOINT ?? endpointFromCluster(process.env.SOLANA_CLUSTER ?? "devnet"),
    [phoenixMarket]
  );
  const phoenixBook = phoenixClient.markets.get(phoenixMarket.toBase58());
  if (!phoenixBook) throw new Error("Phoenix SDK could not load the linked market");

  const yesBalance = await tokenBalance(connection, userYes);
  if (yesBalance < requiredBaseAtoms) {
    const usdcBalance = await tokenBalance(connection, userUsdc);
    if (usdcBalance < mintAmount) {
      throw new Error(
        `Admin USDC ATA ${userUsdc.toBase58()} has ${usdcBalance} raw units; needs ${mintAmount}. Fund it with devnet demo USDC and rerun.`
      );
    }

    console.log(`[phoenix:smoke] Minting ${smokeUsdcUnits.toString()} YES/NO pair`);
    await meridian.methods
      .mintPair(new BN(mintAmount.toString()))
      .accounts({
        user: admin.publicKey,
        config,
        market: meridianMarket,
        yesMint,
        noMint,
        vault,
        userUsdc,
        userYes,
        userNo,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
  } else {
    console.log(`[phoenix:smoke] Reusing existing YES balance: ${yesBalance} raw units`);
  }

  const seat = phoenixBook.getSeatAddress(admin.publicKey);
  const seatInfo = await connection.getAccountInfo(seat, "confirmed");
  if (!seatInfo || seatInfo.data.length === 0) {
    console.log("[phoenix:smoke] Requesting Phoenix seat");
    const requestSeatIx = Phoenix.createRequestSeatInstruction({
      phoenixProgram: Phoenix.PROGRAM_ID,
      logAuthority: Phoenix.getLogAuthority(),
      market: phoenixMarket,
      payer: admin.publicKey,
      seat,
      systemProgram: SystemProgram.programId,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(requestSeatIx), [admin], {
      commitment: "confirmed",
    });
  } else {
    console.log("[phoenix:smoke] Reusing existing Phoenix seat");
  }
  const refreshedSeatInfo = await connection.getAccountInfo(seat, "confirmed");
  if (!refreshedSeatInfo || refreshedSeatInfo.data.length === 0) {
    throw new Error("Phoenix seat account was not created");
  }
  if (seatApprovalStatus(refreshedSeatInfo.data) !== 1n) {
    console.log("[phoenix:smoke] Approving Phoenix seat");
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createChangeSeatStatusIx(phoenixMarket, admin.publicKey, seat, 1)),
      [admin],
      { commitment: "confirmed" }
    );
  } else {
    console.log("[phoenix:smoke] Phoenix seat is already approved");
  }

  const priceInTicks = phoenixBook.floatPriceToTicks(price);
  const numBaseLots = phoenixBook.baseAtomsToBaseLots(Number(requiredBaseAtoms));
  if (numBaseLots <= 0) throw new Error("Smoke size is below the Phoenix base-lot size");

  const orderPacket = Phoenix.getLimitOrderPacket({
    side: Phoenix.Side.Ask,
    priceInTicks,
    numBaseLots,
    clientOrderId: Date.now(),
  });
  const placeIx = phoenixBook.createPlaceLimitOrderInstruction(orderPacket, admin.publicKey);

  console.log(`[phoenix:smoke] Placing ask: ${sizeBaseUnits} YES @ ${price} USDC`);
  const txid = await sendAndConfirmTransaction(connection, new Transaction().add(placeIx), [admin], {
    commitment: "confirmed",
  });
  console.log(`[phoenix:smoke] Order tx: ${txid}`);

  await phoenixClient.refreshMarket(phoenixMarket.toBase58());
  const ladder = phoenixClient.getUiLadder(phoenixMarket.toBase58(), 1);
  const topAsk = ladder.asks[0];
  if (!topAsk) throw new Error("No ask found after placing Phoenix order");
  console.log(`[phoenix:smoke] Top ask price=${topAsk.price} size=${topAsk.quantity}`);
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const result = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
}

function endpointFromCluster(cluster: string): string {
  if (cluster === "localnet") return "localhost";
  if (cluster === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

function createChangeSeatStatusIx(
  market: PublicKey,
  marketAuthority: PublicKey,
  seat: PublicKey,
  status: number
): TransactionInstruction {
  return new TransactionInstruction({
    programId: Phoenix.PROGRAM_ID,
    keys: [
      { pubkey: Phoenix.PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: Phoenix.getLogAuthority(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: marketAuthority, isSigner: true, isWritable: false },
      { pubkey: seat, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([104, status]),
  });
}

function seatApprovalStatus(data: Buffer): bigint {
  if (data.length < 80) return -1n;
  return data.readBigUInt64LE(72);
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
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive numeric env var ${key}: ${value}`);
  return parsed;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
