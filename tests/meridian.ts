import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import type { Meridian } from "../target/types/meridian";

const TOKEN_DECIMALS = 6;
const ONE_USDC = 1_000_000n; // 1.00 USDC in raw units

// "META" right-padded with 0x00 to 8 bytes
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

describe("meridian — Phase 2: mint & redeem", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Meridian as Program<Meridian>;
  const connection = provider.connection;

  // Test fixtures created in before()
  let admin: Keypair;
  let user: Keypair;
  let usdcMint: PublicKey;
  let configKey: PublicKey;

  async function airdrop(pk: PublicKey, sol: number) {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  before(async () => {
    admin = Keypair.generate();
    user = Keypair.generate();
    await airdrop(admin.publicKey, 5);
    await airdrop(user.publicKey, 5);

    // Fake USDC mint we own so we can faucet to the user
    usdcMint = await createMint(connection, admin, admin.publicKey, null, TOKEN_DECIMALS);

    [configKey] = configPda(program.programId);
  });

  it("initialize_config sets admin + usdc mint, paused=false", async () => {
    await program.methods
      .initializeConfig()
      .accounts({
        admin: admin.publicKey,
        config: configKey,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const cfg = await program.account.config.fetch(configKey);
    expect(cfg.admin.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(cfg.usdcMint.toBase58()).to.eq(usdcMint.toBase58());
    expect(cfg.paused).to.eq(false);
  });

  describe("create_strike_market", () => {
    const ticker = tickerBytes("META");
    const strike = new BN(68_000); // $680.00 in cents
    const expiry = new BN(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
    let market: PublicKey;
    let yesMint: PublicKey;
    let noMint: PublicKey;
    let vault: PublicKey;

    before(() => {
      [market] = marketPda(program.programId, ticker, strike, expiry);
      [yesMint] = mintPda(program.programId, "yes", market);
      [noMint] = mintPda(program.programId, "no", market);
      [vault] = vaultPda(program.programId, market);
    });

    it("creates Yes/No mints + USDC vault under the market PDA", async () => {
      await program.methods
        .createStrikeMarket(ticker, strike, expiry)
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

      const m = await program.account.market.fetch(market);
      expect(m.yesMint.toBase58()).to.eq(yesMint.toBase58());
      expect(m.noMint.toBase58()).to.eq(noMint.toBase58());
      expect(m.vault.toBase58()).to.eq(vault.toBase58());
      expect(m.outcome).to.deep.eq({ unsettled: {} });
      expect(m.strikePriceUsdCents.toString()).to.eq("68000");

      const yesM = await getMint(connection, yesMint);
      const noM = await getMint(connection, noMint);
      expect(yesM.decimals).to.eq(TOKEN_DECIMALS);
      expect(noM.decimals).to.eq(TOKEN_DECIMALS);
      expect(yesM.mintAuthority?.toBase58()).to.eq(market.toBase58());
      expect(noM.mintAuthority?.toBase58()).to.eq(market.toBase58());

      const v = await getAccount(connection, vault);
      expect(v.mint.toBase58()).to.eq(usdcMint.toBase58());
      expect(v.owner.toBase58()).to.eq(market.toBase58());
      expect(v.amount).to.eq(0n);
    });

    describe("mint_pair / redeem_pair invariants", () => {
      let userUsdc: PublicKey;
      let userYes: PublicKey;
      let userNo: PublicKey;

      before(async () => {
        userUsdc = await createAssociatedTokenAccount(connection, user, usdcMint, user.publicKey);
        userYes = await createAssociatedTokenAccount(connection, user, yesMint, user.publicKey);
        userNo = await createAssociatedTokenAccount(connection, user, noMint, user.publicKey);
        // Faucet user 100 USDC
        await mintTo(connection, admin, usdcMint, userUsdc, admin, 100n * ONE_USDC);
      });

      it("mint_pair: vault grows by amount; user receives equal Yes + No", async () => {
        const amt = new BN(5n * ONE_USDC); // 5 pairs

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

        const v = await getAccount(connection, vault);
        const y = await getAccount(connection, userYes);
        const n = await getAccount(connection, userNo);
        const yesSupply = (await getMint(connection, yesMint)).supply;
        const noSupply = (await getMint(connection, noMint)).supply;

        expect(v.amount).to.eq(5n * ONE_USDC);
        expect(y.amount).to.eq(5n * ONE_USDC);
        expect(n.amount).to.eq(5n * ONE_USDC);
        // INVARIANT: vault == yes_supply == no_supply
        expect(v.amount).to.eq(yesSupply);
        expect(v.amount).to.eq(noSupply);
      });

      it("redeem_pair: burns matching Yes+No, returns USDC; invariant holds", async () => {
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
        const yesSupply = (await getMint(connection, yesMint)).supply;
        const noSupply = (await getMint(connection, noMint)).supply;

        expect(vBefore - vAfter).to.eq(2n * ONE_USDC);
        expect(uAfter - uBefore).to.eq(2n * ONE_USDC);
        expect(vAfter).to.eq(yesSupply); // still holds after redeem
        expect(vAfter).to.eq(noSupply);
      });

      it("property test: random mint/redeem sequence preserves vault == yes_supply == no_supply", async () => {
        // Generate a random sequence biased toward mint so we don't underflow user balance.
        const ops: Array<{ kind: "mint" | "redeem"; amount: bigint }> = [];
        const rand = (max: number) => Math.floor(Math.random() * max);
        let userPairs = (await getAccount(connection, userYes)).amount;
        for (let i = 0; i < 8; i++) {
          const wantMint = Math.random() < 0.6 || userPairs < ONE_USDC;
          const a = BigInt(rand(3) + 1) * ONE_USDC;
          if (wantMint) {
            ops.push({ kind: "mint", amount: a });
            userPairs += a;
          } else {
            const burn = a > userPairs ? userPairs : a;
            if (burn === 0n) continue;
            ops.push({ kind: "redeem", amount: burn });
            userPairs -= burn;
          }
        }

        for (const op of ops) {
          if (op.kind === "mint") {
            await program.methods
              .mintPair(new BN(op.amount.toString()))
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
          } else {
            await program.methods
              .redeemPair(new BN(op.amount.toString()))
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
          }

          const v = (await getAccount(connection, vault)).amount;
          const ys = (await getMint(connection, yesMint)).supply;
          const ns = (await getMint(connection, noMint)).supply;
          expect(v).to.eq(ys);
          expect(v).to.eq(ns);
        }
      });

      it("mint_pair fails with zero amount", async () => {
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
          expect.fail("expected ZeroAmount");
        } catch (e: any) {
          expect(e.toString()).to.match(/ZeroAmount/);
        }
      });

      it("pause blocks mint_pair; unpause restores it", async () => {
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
          expect.fail("expected Paused");
        } catch (e: any) {
          expect(e.toString()).to.match(/Paused/);
        }

        await program.methods
          .unpause()
          .accounts({ admin: admin.publicKey, config: configKey })
          .signers([admin])
          .rpc();

        // Should succeed now
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
      });

      it("non-admin cannot pause", async () => {
        try {
          await program.methods
            .pause()
            .accounts({ admin: user.publicKey, config: configKey })
            .signers([user])
            .rpc();
          expect.fail("expected NotAdmin");
        } catch (e: any) {
          expect(e.toString()).to.match(/NotAdmin|raw constraint/i);
        }
      });
    });
  });
});
