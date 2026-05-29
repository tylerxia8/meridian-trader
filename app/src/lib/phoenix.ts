// Phoenix CLOB wrapper. We only need a thin layer around the SDK: build
// Buy/Sell instructions and read top-of-book.
//
// API surface kept narrow so trade.ts can compose these into the four user
// actions without touching the SDK directly.
//
// Phoenix devnet caveat: at the time of writing, Phoenix is primarily
// deployed on mainnet-beta. If the devnet program is unavailable, run the
// lifecycle demo against a local validator with the Phoenix program cloned
// from mainnet (see `Anchor.toml` test.validator.clone for the pattern).
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

export type Side = "Buy" | "Sell";

export interface BestBidAsk {
  bestBidPriceInUsdc: number | null;
  bestAskPriceInUsdc: number | null;
}

export class PhoenixWrapper {
  private client: Phoenix.Client;

  private constructor(client: Phoenix.Client) {
    this.client = client;
  }

  static async connect(connection: Connection, endpoint = "devnet"): Promise<PhoenixWrapper> {
    const client = await Phoenix.Client.create(connection, endpoint);
    return new PhoenixWrapper(client);
  }

  /// Load a specific Phoenix market into the client cache. Required before
  /// any place-order or read-orderbook call.
  async ensureMarket(marketAddress: PublicKey): Promise<void> {
    if (!this.client.markets.has(marketAddress.toBase58())) {
      await this.client.addMarket(marketAddress.toBase58());
    }
  }

  /// Read top of book in USDC per Yes token. Returns nulls if the side is
  /// empty (common for fresh markets before any liquidity is posted).
  async getTopOfBook(marketAddress: PublicKey): Promise<BestBidAsk> {
    await this.ensureMarket(marketAddress);
    const ladder = this.client.getUiLadder(marketAddress.toBase58(), 1);
    const bidLadder = ladder.bids;
    const askLadder = ladder.asks;
    return {
      bestBidPriceInUsdc: bidLadder[0]?.price ?? null,
      bestAskPriceInUsdc: askLadder[0]?.price ?? null,
    };
  }

  /// Place a market order (immediate-or-cancel against best opposing side).
  /// sizeInBaseAtoms is in Yes-token raw units (6 decimals).
  async placeMarketOrderIx(args: {
    marketAddress: PublicKey;
    side: Side;
    sizeInBaseAtoms: bigint;
    trader: PublicKey;
  }): Promise<TransactionInstruction> {
    await this.ensureMarket(args.marketAddress);
    const marketAddress = args.marketAddress.toBase58();
    const market = this.client.markets.get(marketAddress);
    if (!market) throw new Error(`Phoenix market not loaded: ${args.marketAddress.toBase58()}`);

    const orderPacket = Phoenix.getImmediateOrCancelOrderPacket({
      side: args.side === "Buy" ? Phoenix.Side.Bid : Phoenix.Side.Ask,
      priceInTicks: args.side === "Buy" ? Number.MAX_SAFE_INTEGER : 1,
      numBaseLots: market.baseAtomsToBaseLots(Number(args.sizeInBaseAtoms)),
      numQuoteLots: Number.MAX_SAFE_INTEGER,
      selfTradeBehavior: Phoenix.SelfTradeBehavior.CancelProvide,
      clientOrderId: 0,
      useOnlyDepositedFunds: false,
    });
    return this.client.createPlaceLimitOrderInstruction(orderPacket, marketAddress, args.trader);
  }

  /// Place a limit order at a specific price.
  async placeLimitOrderIx(args: {
    marketAddress: PublicKey;
    side: Side;
    priceInUsdc: number;
    sizeInBaseAtoms: bigint;
    trader: PublicKey;
    immediateOrCancel?: boolean;
  }): Promise<TransactionInstruction> {
    await this.ensureMarket(args.marketAddress);
    const marketAddress = args.marketAddress.toBase58();
    const market = this.client.markets.get(marketAddress);
    if (!market) throw new Error(`Phoenix market not loaded: ${args.marketAddress.toBase58()}`);

    const packetArgs = {
      side: args.side === "Buy" ? Phoenix.Side.Bid : Phoenix.Side.Ask,
      priceInTicks: market.floatPriceToTicks(args.priceInUsdc),
      numBaseLots: market.baseAtomsToBaseLots(Number(args.sizeInBaseAtoms)),
      selfTradeBehavior: Phoenix.SelfTradeBehavior.CancelProvide,
      clientOrderId: 0,
      useOnlyDepositedFunds: false,
    };
    const orderPacket = args.immediateOrCancel
      ? Phoenix.getImmediateOrCancelOrderPacket({
          ...packetArgs,
          numQuoteLots: Number.MAX_SAFE_INTEGER,
        })
      : Phoenix.getLimitOrderPacket(packetArgs);
    return this.client.createPlaceLimitOrderInstruction(orderPacket, marketAddress, args.trader);
  }
}
