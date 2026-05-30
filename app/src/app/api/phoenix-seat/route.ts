import { Connection, PublicKey } from "@solana/web3.js";
import { envValue } from "@/lib/server/env";
import { ensurePhoenixSeat } from "@/lib/server/phoenix-seat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      phoenixMarket?: string;
      user?: string;
    };
    if (!body.phoenixMarket || !body.user) {
      return Response.json({ error: "Missing Phoenix seat request fields" }, { status: 400 });
    }

    const rpcUrl = envValue("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
    const result = await ensurePhoenixSeat({
      connection: new Connection(rpcUrl, "confirmed"),
      phoenixMarket: new PublicKey(body.phoenixMarket),
      trader: new PublicKey(body.user),
    });

    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
