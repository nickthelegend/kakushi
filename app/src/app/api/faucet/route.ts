// LOCAL FORK ONLY: gas (anvil_setBalance) and test AUSD (Agora's real faucet contract, as forked) for
// fresh accounts, e.g. a guest or a Privy embedded wallet while the app runs against the fork.
import { NextResponse } from "next/server";
import { encodeFunctionData, isAddress, parseEther, toHex, type Hex } from "viem";
import { LOCAL_SPONSOR_KEY, network, readDeployments } from "@/lib/server";
import { AUSD_FAUCET, faucetAbi, withBuffer } from "@/lib/pay/core";
import { sendFromLocalKey, serverClient } from "@/lib/pay/server-tx";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (network() !== "local") return NextResponse.json({ error: "faucet only exists on the local fork" }, { status: 404 });
  let b: { address?: string; mon?: boolean; ausd?: boolean };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!isAddress(b.address ?? "")) return NextResponse.json({ error: "address required" }, { status: 400 });
  const who = b.address as Hex;
  const c = serverClient();
  const out: Record<string, unknown> = {};
  if (b.mon !== false) {
    const bal = await c.getBalance({ address: who });
    if (bal < parseEther("0.5")) await c.request({ method: "anvil_setBalance" as never, params: [who, toHex(parseEther("1"))] as never });
    out.mon = "1";
  }
  if (b.ausd) {
    const apps = readDeployments().apps;
    if (!apps?.ausd) return NextResponse.json({ error: "AUSD not configured" }, { status: 503 });
    try {
      const data = encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [who] });
      const gas = await c.estimateGas({ account: privateKeyToAccount(LOCAL_SPONSOR_KEY).address, to: AUSD_FAUCET, data });
      const s = await sendFromLocalKey(LOCAL_SPONSOR_KEY, { to: AUSD_FAUCET, data, gas: withBuffer(gas) });
      out.ausd = s.status === "success" ? "10000" : "faucet reverted";
    } catch (e) {
      return NextResponse.json({ ...out, error: `Agora's AUSD faucet refused (it has a 60 s global cooldown): ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]}` }, { status: 429 });
    }
  }
  return NextResponse.json(out);
}
