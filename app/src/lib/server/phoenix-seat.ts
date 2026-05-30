import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { envValue, requiredEnvValue } from "./env";

export type PhoenixSeatResult = {
  seat: string;
  requested: boolean;
  approved: boolean;
  signature: string | null;
};

export async function ensurePhoenixSeat(args: {
  connection: Connection;
  phoenixMarket: PublicKey;
  trader: PublicKey;
}): Promise<PhoenixSeatResult> {
  const admin = loadAdminKeypair();
  const endpoint = envValue("PHOENIX_ENDPOINT") ?? endpointFromCluster(envValue("NEXT_PUBLIC_SOLANA_CLUSTER", "SOLANA_CLUSTER") ?? "devnet");
  const client = await Phoenix.Client.createWithMarketAddresses(args.connection, endpoint, [args.phoenixMarket]);
  const book = client.markets.get(args.phoenixMarket.toBase58());
  if (!book) throw new Error("Phoenix SDK could not load the linked market");

  const seat = book.getSeatAddress(args.trader);
  const ixs: TransactionInstruction[] = [];
  let requested = false;
  let approved = false;

  const seatInfo = await args.connection.getAccountInfo(seat, "confirmed");
  if (!seatInfo || seatInfo.data.length === 0) {
    ixs.push(book.createRequestSeatInstruction(admin.publicKey, args.trader));
    requested = true;
  }

  const approvalStatus = seatInfo && seatInfo.data.length > 0 ? seatApprovalStatus(Buffer.from(seatInfo.data)) : -1n;
  if (approvalStatus !== 1n) {
    ixs.push(createChangeSeatStatusIx(args.phoenixMarket, admin.publicKey, seat, 1));
    approved = true;
  }

  if (ixs.length === 0) {
    return { seat: seat.toBase58(), requested: false, approved: false, signature: null };
  }

  const signature = await sendAndConfirmTransaction(args.connection, new Transaction().add(...ixs), [admin], {
    commitment: "confirmed",
  });
  return { seat: seat.toBase58(), requested, approved, signature };
}

function loadAdminKeypair(): Keypair {
  const walletPath = requiredEnvValue("ANCHOR_WALLET");
  const candidates = [
    path.resolve(process.cwd(), walletPath),
    path.resolve(process.cwd(), "..", walletPath),
    path.resolve(walletPath),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`ANCHOR_WALLET file not found: ${walletPath}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(found, "utf8"))));
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
