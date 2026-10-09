// Payroll run by an operator on the employer's behalf: scheduled or automated payroll while the
// employer is offline. The operator is a Privy server wallet whose Privy policy only allows
// runPayrollFrom on cAUSD on chain 10143 until a fixed date (scripts/privy-setup.ts). On the local
// fork without Privy credentials, a LOCAL ANVIL ONLY dev key stands in for it.
//
// Trust model: the browser encrypts every salary for the operator's address (the server never sees
// an amount) and the employer signs the exact batch (EIP-712, PayrollBatch). This route only submits
// batches signed by an employer who has authorized this operator on-chain (setOperator).
import { NextResponse } from "next/server";
import { encodeFunctionData, isAddress, isHex, keccak256, type Hex } from "viem";
import { payAbi } from "@/lib/abi";
import { network, payrollOperator, privyServer, readDeployments, LOCAL_OPERATOR_KEY } from "@/lib/server";
import { MONAD_TESTNET_ID, payrollBatchTypedData, withBuffer } from "@/lib/pay/core";
import { sendFromLocalKey, sendFromPrivyServerWallet, serverClient, type ServerSent } from "@/lib/pay/server-tx";

export const dynamic = "force-dynamic";

interface Batch {
  employer: Hex;
  to: Hex[];
  amounts: Hex[];
  proofs: Hex[];
  ref: Hex;
  deadline: string;
  signature: Hex;
  runAt?: number | null;
}

type Job = { id: string; employer: Hex; count: number; runAt: number; status: "scheduled" | "running" | "done" | "failed"; result?: Record<string, unknown>; error?: string };

// In-process scheduler (dev server / single instance). In production a cron (e.g. Vercel Cron) would
// POST due batches from durable storage; the signed batch is self-contained, so either works.
const g = globalThis as unknown as { __fhishPayroll?: { jobs: Map<string, Job>; used: Set<string> } };
const state = (g.__fhishPayroll ??= { jobs: new Map(), used: new Set() });

const MAX_ROWS = 50;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

function token(): Hex | null {
  return (readDeployments().apps?.causd as Hex | undefined) ?? null;
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("job");
  if (id) {
    const j = state.jobs.get(id);
    return j ? NextResponse.json(j) : bad("unknown job", 404);
  }
  const op = payrollOperator();
  const p = privyServer();
  return NextResponse.json({
    network: network(),
    chainId: MONAD_TESTNET_ID,
    token: token(),
    operator: op,
    privy: { serverWallet: p.serverWalletReady, policyId: p.policyId, sponsor: p.sponsor },
    jobs: [...state.jobs.values()].slice(-20),
  });
}

async function submit(b: Batch, tokenAddr: Hex, operator: Hex): Promise<ServerSent> {
  const c = serverClient();
  const args = [b.employer, b.to, b.amounts, b.proofs, b.ref] as const;
  const gas = await c.estimateContractGas({ address: tokenAddr, abi: payAbi, functionName: "runPayrollFrom", args, account: operator });
  const tx = { to: tokenAddr, data: encodeFunctionData({ abi: payAbi, functionName: "runPayrollFrom", args }), gas: withBuffer(gas) };
  const op = payrollOperator()!;
  return op.kind === "privy-server-wallet" ? sendFromPrivyServerWallet(tx) : sendFromLocalKey(LOCAL_OPERATOR_KEY, tx);
}

const view = (s: ServerSent) => ({ hash: s.hash, blockNumber: s.blockNumber.toString(), status: s.status, sync: s.sync, receiptMs: s.ms, via: s.via });

export async function POST(req: Request) {
  const tokenAddr = token();
  const op = payrollOperator();
  if (!tokenAddr) return bad("cAUSD is not deployed on this network", 503);
  if (!op) return bad("No payroll operator: configure the Privy server wallet (app/PRIVY.md)", 503);

  let b: Batch;
  try {
    b = await req.json();
  } catch {
    return bad("invalid JSON");
  }
  if (!isAddress(b.employer ?? "")) return bad("employer must be an address");
  if (!Array.isArray(b.to) || !b.to.length || b.to.length > MAX_ROWS) return bad(`1 to ${MAX_ROWS} recipients`);
  if (!Array.isArray(b.amounts) || !Array.isArray(b.proofs) || b.amounts.length !== b.to.length || b.proofs.length !== b.to.length) return bad("recipients, amounts and proofs must line up");
  if (!b.to.every((a) => isAddress(a))) return bad("every recipient must be an address");
  if (!b.amounts.every((h) => isHex(h) && h.length === 66) || !b.proofs.every((p) => isHex(p))) return bad("amounts must be bytes32 handles and proofs hex");
  if (!isHex(b.ref) || b.ref.length !== 66 || !isHex(b.signature)) return bad("ref (bytes32) and signature required");
  let deadline: bigint;
  try {
    deadline = BigInt(b.deadline);
  } catch {
    return bad("deadline must be an integer");
  }
  const runAt = b.runAt ? Number(b.runAt) : null;
  if (runAt !== null && (!Number.isFinite(runAt) || runAt > Date.now() + 7 * 86400_000)) return bad("runAt must be within 7 days");
  if (deadline * 1000n < BigInt(runAt ?? Date.now())) return bad("authorization deadline is before the run time");

  // 1. the employer signed this exact batch for this operator (EOA, ERC-1271 or EIP-7702 accounts)
  const c = serverClient();
  const ok = await c
    .verifyTypedData({ address: b.employer, signature: b.signature, ...payrollBatchTypedData({ chainId: MONAD_TESTNET_ID, token: tokenAddr, employer: b.employer, operator: op.address, to: b.to, amounts: b.amounts, ref: b.ref, deadline }) })
    .catch(() => false);
  if (!ok) return bad("batch signature does not match the employer", 401);
  const sigId = keccak256(b.signature);
  if (state.used.has(sigId)) return bad("this batch was already submitted", 409);

  // 2. the employer authorized this operator on-chain, for long enough
  const until = Number(await c.readContract({ address: tokenAddr, abi: payAbi, functionName: "operatorUntil", args: [b.employer, op.address] }));
  const needed = Math.floor((runAt ?? Date.now()) / 1000);
  if (until < needed) return bad(`operator ${op.address} is not authorized by ${b.employer} at the run time (setOperator first)`, 409);

  state.used.add(sigId);
  if (runAt && runAt > Date.now() + 1000) {
    const id = sigId.slice(2, 14);
    const job: Job = { id, employer: b.employer, count: b.to.length, runAt, status: "scheduled" };
    state.jobs.set(id, job);
    setTimeout(async () => {
      job.status = "running";
      try {
        const s = await submit(b, tokenAddr, op.address);
        job.status = s.status === "success" ? "done" : "failed";
        job.result = view(s);
      } catch (e) {
        job.status = "failed";
        job.error = (e as Error).message.split("\n")[0];
      }
    }, runAt - Date.now());
    return NextResponse.json({ scheduled: { id, runAt }, operator: op });
  }

  try {
    const s = await submit(b, tokenAddr, op.address);
    if (s.status !== "success") return NextResponse.json({ error: "runPayrollFrom reverted", ...view(s) }, { status: 502 });
    return NextResponse.json({ ...view(s), operator: op });
  } catch (e) {
    state.used.delete(sigId);
    return bad((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!, 502);
  }
}
