import cron from "node-cron";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { loadProgram } from "./program.js";
import { runMorningJob } from "./jobs/morning.js";
import { runSettlementJob } from "./jobs/settlement.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = loadProgram(cfg);

  logger.info(
    {
      cluster: cfg.cluster,
      programId: cfg.programId.toBase58(),
      automationKey: ctx.wallet.publicKey.toBase58(),
      morningCron: cfg.morningCron,
      settlementCron: cfg.settlementCron,
    },
    "automation service starting"
  );

  // Schedule jobs in Eastern time so NYSE-aligned crons are intuitive.
  cron.schedule(
    cfg.morningCron,
    () => {
      runMorningJob(cfg, ctx).catch((err) =>
        logger.error({ err: err.message, stack: err.stack }, "morning job crashed")
      );
    },
    { timezone: "America/New_York" }
  );

  cron.schedule(
    cfg.settlementCron,
    () => {
      runSettlementJob(cfg, ctx).catch((err) =>
        logger.error({ err: err.message, stack: err.stack }, "settlement job crashed")
      );
    },
    { timezone: "America/New_York" }
  );

  // Allow manual one-shot runs via CLI: `tsx src/index.ts morning` or `settlement`.
  const arg = process.argv[2];
  if (arg === "morning") {
    await runMorningJob(cfg, ctx);
    process.exit(0);
  } else if (arg === "settlement") {
    await runSettlementJob(cfg, ctx);
    process.exit(0);
  }

  logger.info("scheduler is live; press Ctrl+C to exit");
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "fatal");
  process.exit(1);
});
