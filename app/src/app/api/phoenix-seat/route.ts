import { PublicKey } from "@solana/web3.js";
import { ensurePhoenixSeat } from "@/lib/server/phoenix-seat";
import {
  activeMarketError,
  createMeridianServerContext,
  linkedPhoenixMarketError,
} from "@/lib/server/meridian";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      marketAddress?: string;
      phoenixMarket?: string;
      user?: string;
    };
    if (!body.marketAddress || !body.phoenixMarket || !body.user) {
      return Response.json({ error: "Missing Phoenix seat request fields" }, { status: 400 });
    }

    const { connection, program } = await createMeridianServerContext();
    const marketAddress = new PublicKey(body.marketAddress);
    const phoenixMarket = new PublicKey(body.phoenixMarket);
    const marketAccount = await (program.account as any).market.fetch(marketAddress);
    const marketError = activeMarketError(marketAccount);
    if (marketError) return Response.json({ error: marketError }, { status: 400 });
    const phoenixError = linkedPhoenixMarketError(marketAccount, phoenixMarket);
    if (phoenixError) return Response.json({ error: phoenixError }, { status: 400 });

    const result = await ensurePhoenixSeat({
      connection,
      phoenixMarket,
      trader: new PublicKey(body.user),
    });

    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
