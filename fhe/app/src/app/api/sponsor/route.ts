// LOCAL FORK ONLY: a stand-in for Privy's paymaster, so a brand-new account with no gas can claim a
// pay link on the fork. It submits only cAUSD.claimLink, whose link-key signature binds the recipient,
// so the relayer cannot redirect funds. On Monad testnet this route is off: the new user's Privy
// embedded wallet sends claimLink itself with { sponsor: true }.
import { NextResponse } from "next/server";
import { decodeFunctionData, isHex, type Hex } from "viem";
import { payAbi } from "@/lib/abi";
import { LOCAL_SPONSOR_KEY, network, readDeployments } from "@/lib/server";
import { withBuffer } from "@/lib/pay/core";
import { sendFromLocalKey, serverClient } from "@/lib/pay/server-tx";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["claimLink"]);

export async function POST(req: Request) {
  if (network() !== "local") return NextResponse.json({ error: "The local sponsor only runs on the fork; on testnet gas is sponsored by Privy." }, { status: 404 });
  const token = readDeployments().apps?.causd as Hex | undefined;
  let body: { to?: string; data?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!token || body.to?.toLowerCase() !== token.toLowerCase() || !isHex(body.data)) return NextResponse.json({ error: "only cAUSD calls are sponsored" }, { status: 400 });
  let fn: string;
  try {
    fn = decodeFunctionData({ abi: payAbi, data: body.data }).functionName;
  } catch {
    return NextResponse.json({ error: "unrecognized call" }, { status: 400 });
  }
  if (!ALLOWED.has(fn)) return NextResponse.json({ error: `${fn} is not sponsored` }, { status: 403 });
  try {
    const sponsor = privateKeyToAccount(LOCAL_SPONSOR_KEY).address;
    const gas = await serverClient().estimateGas({ account: sponsor, to: token, data: body.data });
    const s = await sendFromLocalKey(LOCAL_SPONSOR_KEY, { to: token, data: body.data, gas: withBuffer(gas) });
    if (s.status !== "success") return NextResponse.json({ error: "claim reverted", hash: s.hash }, { status: 502 });
    return NextResponse.json({ hash: s.hash, blockNumber: s.blockNumber.toString(), sync: s.sync, sponsor });
  } catch (e) {
    return NextResponse.json({ error: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0] }, { status: 502 });
  }
}
