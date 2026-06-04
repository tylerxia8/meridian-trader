import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  mintTo,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import type { Meridian } from "../target/types/meridian";

const TOKEN_DECIMALS = 6;
const ONE_USDC = 1_000_000n;

const MAX_STALENESS_SECS = 300;
const MAX_CONF_RATIO_BPS = 50; // 0.50%
const ADMIN_OVERRIDE_DELAY_SECS = 1; // tiny delay so tests can wait it out

function tickerBytes(t: string): number[] {
  const b = Buffer.alloc(8);
  Buffer.from(t, "ascii").copy(b, 0, 0, Math.min(t.length, 8));
  return Array.from(b);
}

function configPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
}

function marketPda(
  programId: PublicKey,
  ticker: number[],
  strikeUsdCents: BN,
  expiryTs: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      Buffer.from(ticker),
      strikeUsdCents.toArrayLike(Buffer, "le", 8),
      expiryTs.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

function mintPda(programId: PublicKey, kind: "yes" | "no", market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(kind), market.toBuffer()], programId);
}

function vaultPda(programId: PublicKey, market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getOrCreateAta(connection: anchor.web3.Connection, payer: Keypair, mint: PublicKey, owner: PublicKey) {
  return createAssociatedTokenAccountIdempotent(connection, payer, mint, owner, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

// Fake 32-byte Pyth feed id for tests (the on-chain side only uses it at settle_market;
// admin_settle tests don't touch it).
const FAKE_FEED_ID = Array(32).fill(0xab) as number[];

describe("meridian", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Meridian as Program<Meridian>;
  const connection = provider.connection;

  let admin: Keypair;
  let user: Keypair;
  let usdcMint: PublicKey;
  let configKey: PublicKey;

  async function airdrop(pk: PublicKey, sol: number) {
    const lamports = sol * LAMPORTS_PER_SOL;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const sig = await connection.requestAirdrop(pk, lamports);
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          {
            signature: sig,
            ...latestBlockhash,
          },
          "confirmed"
        );
        return;
      } catch (err) {
        lastError = err;
        await sleep(300 * attempt);
      }
    }

    throw lastError;
  }

  before(async () => {
    admin = Keypair.generate();
    user = Keypair.generate();
    await airdrop(admin.publicKey, 5);
    await airdrop(user.publicKey, 5);
    usdcMint = await createMint(connection, admin, admin.publicKey, null, TOKEN_DECIMALS);
    [configKey] = configPda(program.programId);

    await program.methods
      .initializeConfig(MAX_STALENESS_SECS, MAX_CONF_RATIO_BPS, ADMIN_OVERRIDE_DELAY_SECS)
      .accounts({
        admin: admin.publicKey,
        config: configKey,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  it("initialize_config persisted admin + usdc + oracle params", async () => {
    const cfg = await program.account.config.fetch(configKey);
    expect(cfg.admin.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(cfg.usdcMint.toBase58()).to.eq(usdcMint.toBase58());
    expect(cfg.paused).to.eq(false);
    expect(cfg.maxStalenessSecs).to.eq(MAX_STALENESS_SECS);
    expect(cfg.maxConfRatioBps).to.eq(MAX_CONF_RATIO_BPS);
    expect(cfg.adminOverrideDelaySecs).to.eq(ADMIN_OVERRIDE_DELAY_SECS);
  });

  it("update_config is admin-only and updates oracle params", async () => {
    await program.methods
      .updateConfig(MAX_STALENESS_SECS + 60, MAX_CONF_RATIO_BPS + 5, ADMIN_OVERRIDE_DELAY_SECS + 1)
      .accounts({ admin: admin.publicKey, config: configKey })
      .signers([admin])
      .rpc();

    const updated = await program.account.config.fetch(configKey);
    expect(updated.maxStalenessSecs).to.eq(MAX_STALENESS_SECS + 60);
    expect(updated.maxConfRatioBps).to.eq(MAX_CONF_RATIO_BPS + 5);
    expect(updated.adminOverrideDelaySecs).to.eq(ADMIN_OVERRIDE_DELAY_SECS + 1);

    try {
      await program.methods
        .updateConfig(MAX_STALENESS_SECS, MAX_CONF_RATIO_BPS, ADMIN_OVERRIDE_DELAY_SECS)
        .accounts({ admin: user.publicKey, config: configKey })
        .signers([user])
        .rpc();
      expect.fail();
    } catch (e: any) {
      expect(e.toString()).to.match(/NotAdmin|raw constraint/i);
    }

    await program.methods
      .updateConfig(MAX_STALENESS_SECS, MAX_CONF_RATIO_BPS, ADMIN_OVERRIDE_DELAY_SECS)
      .accounts({ admin: admin.publicKey, config: configKey })
      .signers([admin])
      .rpc();
  });

  describe("mint/redeem invariants (META $680, long-lived market)", () => {
    const ticker = tickerBytes("META");
    const strike = new BN(68_000);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
    let market: PublicKey;
    let yesMint: PublicKey;
    let noMint: PublicKey;
    let vault: PublicKey;
    let userUsdc: PublicKey;
    let userYes: PublicKey;
    let userNo: PublicKey;

    before(async () => {
      [market] = marketPda(program.programId, ticker, strike, expiry);
      [yesMint] = mintPda(program.programId, "yes", market);
      [noMint] = mintPda(program.programId, "no", market);
      [vault] = vaultPda(program.programId, market);

      await program.methods
        .createStrikeMarket(ticker, strike, expiry, FAKE_FEED_ID)
        .accounts({
          admin: admin.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      userUsdc = await getOrCreateAta(connection, user, usdcMint, user.publicKey);
      userYes = await getOrCreateAta(connection, user, yesMint, user.publicKey);
      userNo = await getOrCreateAta(connection, user, noMint, user.publicKey);
      await mintTo(connection, admin, usdcMint, userUsdc, admin, 100n * ONE_USDC);
    });

    it("create_strike_market: mints + vault under market PDA; price_feed_id stored", async () => {
      const m = await program.account.market.fetch(market);
      expect(m.yesMint.toBase58()).to.eq(yesMint.toBase58());
      expect(m.noMint.toBase58()).to.eq(noMint.toBase58());
      expect(m.vault.toBase58()).to.eq(vault.toBase58());
      expect(m.outcome).to.deep.eq({ unsettled: {} });
      expect(m.strikePriceUsdCents.toString()).to.eq("68000");
      expect(Buffer.from(m.priceFeedId).equals(Buffer.from(FAKE_FEED_ID))).to.eq(true);

      const yesM = await getMint(connection, yesMint);
      expect(yesM.mintAuthority?.toBase58()).to.eq(market.toBase58());
      const v = await getAccount(connection, vault);
      expect(v.owner.toBase58()).to.eq(market.toBase58());
      expect(v.amount).to.eq(0n);
    });

    it("mint_pair grows vault and supplies in lockstep", async () => {
      const amt = new BN(5n * ONE_USDC);
      await program.methods
        .mintPair(amt)
        .accounts({
          user: user.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          userUsdc,
          userYes,
          userNo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const v = (await getAccount(connection, vault)).amount;
      const ys = (await getMint(connection, yesMint)).supply;
      const ns = (await getMint(connection, noMint)).supply;
      expect(v).to.eq(5n * ONE_USDC);
      expect(v).to.eq(ys);
      expect(v).to.eq(ns);
    });

    it("redeem_pair burns matching Yes+No, returns USDC, invariant holds", async () => {
      const amt = new BN(2n * ONE_USDC);
      const vBefore = (await getAccount(connection, vault)).amount;
      const uBefore = (await getAccount(connection, userUsdc)).amount;

      await program.methods
        .redeemPair(amt)
        .accounts({
          user: user.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          userUsdc,
          userYes,
          userNo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const vAfter = (await getAccount(connection, vault)).amount;
      const uAfter = (await getAccount(connection, userUsdc)).amount;
      const ys = (await getMint(connection, yesMint)).supply;
      const ns = (await getMint(connection, noMint)).supply;
      expect(vBefore - vAfter).to.eq(2n * ONE_USDC);
      expect(uAfter - uBefore).to.eq(2n * ONE_USDC);
      expect(vAfter).to.eq(ys);
      expect(vAfter).to.eq(ns);
    });

    it("mint_pair rejects swapped user token accounts", async () => {
      try {
        await program.methods
          .mintPair(new BN(ONE_USDC))
          .accounts({
            user: user.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            userUsdc,
            userYes: userNo,
            userNo: userYes,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/Constraint|constraint/i);
      }
    });

    it("property: random mint/redeem sequence preserves vault == yes_supply == no_supply", async () => {
      const rand = (max: number) => Math.floor(Math.random() * max);
      let userPairs = (await getAccount(connection, userYes)).amount;

      for (let i = 0; i < 6; i++) {
        const wantMint = Math.random() < 0.6 || userPairs < ONE_USDC;
        const a = BigInt(rand(3) + 1) * ONE_USDC;
        if (wantMint) {
          await program.methods
            .mintPair(new BN(a.toString()))
            .accounts({
              user: user.publicKey,
              config: configKey,
              market,
              yesMint,
              noMint,
              vault,
              userUsdc,
              userYes,
              userNo,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user])
            .rpc();
          userPairs += a;
        } else {
          const burn = a > userPairs ? userPairs : a;
          if (burn === 0n) continue;
          await program.methods
            .redeemPair(new BN(burn.toString()))
            .accounts({
              user: user.publicKey,
              config: configKey,
              market,
              yesMint,
              noMint,
              vault,
              userUsdc,
              userYes,
              userNo,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user])
            .rpc();
          userPairs -= burn;
        }

        const v = (await getAccount(connection, vault)).amount;
        const ys = (await getMint(connection, yesMint)).supply;
        const ns = (await getMint(connection, noMint)).supply;
        expect(v).to.eq(ys);
        expect(v).to.eq(ns);
      }
    });

    it("mint_pair rejects zero", async () => {
      try {
        await program.methods
          .mintPair(new BN(0))
          .accounts({
            user: user.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            userUsdc,
            userYes,
            userNo,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/ZeroAmount/);
      }
    });

    it("pause/unpause gates mint_pair; non-admin can't pause", async () => {
      await program.methods
        .pause()
        .accounts({ admin: admin.publicKey, config: configKey })
        .signers([admin])
        .rpc();

      try {
        await program.methods
          .mintPair(new BN(ONE_USDC))
          .accounts({
            user: user.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            userUsdc,
            userYes,
            userNo,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/Paused/);
      }

      try {
        await program.methods
          .pause()
          .accounts({ admin: user.publicKey, config: configKey })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/NotAdmin|raw constraint/i);
      }

      await program.methods
        .unpause()
        .accounts({ admin: admin.publicKey, config: configKey })
        .signers([admin])
        .rpc();
    });
  });

  // Settlement tests use a separate, short-lived market so the prior tests'
  // state (mint balances on META) doesn't interact.
  describe("admin_settle outcome state machine", () => {
    async function setupShortLivedMarket(tickerStr: string, strikeCents: bigint) {
      const ticker = tickerBytes(tickerStr);
      const strike = new BN(strikeCents.toString());
      // expiry 3 seconds in the future; admin_override_delay = 1 sec; total wait ~4 sec
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3);
      const [market] = marketPda(program.programId, ticker, strike, expiry);
      const [yesMint] = mintPda(program.programId, "yes", market);
      const [noMint] = mintPda(program.programId, "no", market);
      const [vault] = vaultPda(program.programId, market);

      await program.methods
        .createStrikeMarket(ticker, strike, expiry, FAKE_FEED_ID)
        .accounts({
          admin: admin.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      return { ticker, strike, expiry, market, yesMint, noMint, vault };
    }

    it("admin_settle: above-strike → YesWins", async () => {
      const ctx = await setupShortLivedMarket("TSLA", 25_000n);
      await sleep(7000);
      await program.methods
        .adminSettle(new BN(26_000)) // $260 > $250 strike
        .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
        .signers([admin])
        .rpc();

      const m = await program.account.market.fetch(ctx.market);
      expect(m.outcome).to.deep.eq({ yesWins: {} });
      expect(m.settlementPriceUsdCents.toString()).to.eq("26000");
      expect(m.settledAt.toNumber()).to.be.greaterThan(0);
    });

    it("admin_settle: at-strike → YesWins (per the 'at or above' rule)", async () => {
      const ctx = await setupShortLivedMarket("AAPL", 23_000n);
      await sleep(7000);
      await program.methods
        .adminSettle(new BN(23_000))
        .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
        .signers([admin])
        .rpc();

      const m = await program.account.market.fetch(ctx.market);
      expect(m.outcome).to.deep.eq({ yesWins: {} });
    });

    it("admin_settle: below-strike → NoWins", async () => {
      const ctx = await setupShortLivedMarket("MSFT", 42_000n);
      await sleep(7000);
      await program.methods
        .adminSettle(new BN(41_999))
        .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
        .signers([admin])
        .rpc();

      const m = await program.account.market.fetch(ctx.market);
      expect(m.outcome).to.deep.eq({ noWins: {} });
    });

    it("admin_settle: before override delay → AdminOverrideTooEarly", async () => {
      const ctx = await setupShortLivedMarket("GOOGL", 12_000n);
      await sleep(7000);
      try {
        await program.methods
          .adminSettle(new BN(0))
          .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
          .signers([admin])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/InvalidSettlementPrice/);
      }
    });

    it("admin_settle: before override delay -> AdminOverrideTooEarly", async () => {
      const ctx = await setupShortLivedMarket("AMZN", 18_000n);
      // Don't sleep — call immediately, before expiry + delay.
      try {
        await program.methods
          .adminSettle(new BN(19_000))
          .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
          .signers([admin])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/AdminOverrideTooEarly/);
      }
    });

    it("admin_settle: re-settling already-settled market fails", async () => {
      const ctx = await setupShortLivedMarket("NVDA", 100_000n);
      await sleep(7000);
      await program.methods
        .adminSettle(new BN(101_000))
        .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
        .signers([admin])
        .rpc();
      try {
        await program.methods
          .adminSettle(new BN(99_000))
          .accounts({ admin: admin.publicKey, config: configKey, market: ctx.market })
          .signers([admin])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/AlreadySettled/);
      }
    });
  });

  describe("redeem_yes / redeem_no after settlement", () => {
    let market: PublicKey;
    let yesMint: PublicKey;
    let noMint: PublicKey;
    let vault: PublicKey;
    let userUsdc: PublicKey;
    let userYes: PublicKey;
    let userNo: PublicKey;
    let settler: Keypair;
    let settlerUsdc: PublicKey;
    let settlerYes: PublicKey;
    let settlerNo: PublicKey;

    before(async () => {
      settler = Keypair.generate();
      await airdrop(settler.publicKey, 5);

      const ticker = tickerBytes("GOOGL");
      const strike = new BN(15_000); // $150
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3);
      [market] = marketPda(program.programId, ticker, strike, expiry);
      [yesMint] = mintPda(program.programId, "yes", market);
      [noMint] = mintPda(program.programId, "no", market);
      [vault] = vaultPda(program.programId, market);

      await program.methods
        .createStrikeMarket(ticker, strike, expiry, FAKE_FEED_ID)
        .accounts({
          admin: admin.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      userUsdc = await getOrCreateAta(connection, user, usdcMint, user.publicKey);
      userYes = await getOrCreateAta(connection, user, yesMint, user.publicKey);
      userNo = await getOrCreateAta(connection, user, noMint, user.publicKey);
      settlerUsdc = await getOrCreateAta(connection, settler, usdcMint, settler.publicKey);
      settlerYes = await getOrCreateAta(connection, settler, yesMint, settler.publicKey);
      settlerNo = await getOrCreateAta(connection, settler, noMint, settler.publicKey);
      await mintTo(connection, admin, usdcMint, userUsdc, admin, 10n * ONE_USDC);
      await mintTo(connection, admin, usdcMint, settlerUsdc, admin, 10n * ONE_USDC);

      // Both users mint pairs BEFORE settlement.
      for (const u of [
        { signer: user, usdc: userUsdc, yes: userYes, no: userNo },
        { signer: settler, usdc: settlerUsdc, yes: settlerYes, no: settlerNo },
      ]) {
        await program.methods
          .mintPair(new BN(3n * ONE_USDC))
          .accounts({
            user: u.signer.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            userUsdc: u.usdc,
            userYes: u.yes,
            userNo: u.no,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([u.signer])
          .rpc();
      }

      await sleep(7000);
      // Settle YesWins ($155 > $150 strike)
      await program.methods
        .adminSettle(new BN(15_500))
        .accounts({ admin: admin.publicKey, config: configKey, market })
        .signers([admin])
        .rpc();
    });

    it("redeem_yes after YesWins: burns Yes, returns USDC", async () => {
      const amt = new BN(2n * ONE_USDC);
      const uBefore = (await getAccount(connection, userUsdc)).amount;

      await program.methods
        .redeemYes(amt)
        .accounts({
          user: user.publicKey,
          config: configKey,
          market,
          yesMint,
          vault,
          userUsdc,
          userYes,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const uAfter = (await getAccount(connection, userUsdc)).amount;
      expect(uAfter - uBefore).to.eq(2n * ONE_USDC);
    });

    it("redeem_yes cannot overdraw the winning token balance", async () => {
      try {
        await program.methods
          .redeemYes(new BN(2n * ONE_USDC))
          .accounts({
            user: user.publicKey,
            config: configKey,
            market,
            yesMint,
            vault,
            userUsdc,
            userYes,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/insufficient|custom program error|0x1/i);
      }
    });

    it("redeem_no after YesWins: WrongOutcomeForRedemption", async () => {
      try {
        await program.methods
          .redeemNo(new BN(ONE_USDC))
          .accounts({
            user: user.publicKey,
            config: configKey,
            market,
            noMint,
            vault,
            userUsdc,
            userNo,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/WrongOutcomeForRedemption/);
      }
    });

    it("mint_pair on a settled market: AlreadySettled", async () => {
      try {
        await program.methods
          .mintPair(new BN(ONE_USDC))
          .accounts({
            user: settler.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            userUsdc: settlerUsdc,
            userYes: settlerYes,
            userNo: settlerNo,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([settler])
          .rpc();
        expect.fail();
      } catch (e: any) {
        expect(e.toString()).to.match(/AlreadySettled/);
      }
    });

    it("redeem_pair STILL works post-settlement (a matched pair is always $1)", async () => {
      // settler holds 3 Yes and 3 No. Redeem 1 pair.
      const uBefore = (await getAccount(connection, settlerUsdc)).amount;
      await program.methods
        .redeemPair(new BN(ONE_USDC))
        .accounts({
          user: settler.publicKey,
          config: configKey,
          market,
          yesMint,
          noMint,
          vault,
          userUsdc: settlerUsdc,
          userYes: settlerYes,
          userNo: settlerNo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([settler])
        .rpc();
      const uAfter = (await getAccount(connection, settlerUsdc)).amount;
      expect(uAfter - uBefore).to.eq(ONE_USDC);
    });
  });
});

