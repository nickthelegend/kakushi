// FHE coprocessor load: one row per opcode and one per calling contract. Scalar operands and
// trivial-encrypt constants are plaintext in the events; they are deliberately not stored.
import { indexer, type FheCallerStat, type FheOpStat } from "envio";
import { type Ctx, lc, tokenLabel } from "../lib/common";
import { Unit } from "../lib/unit";

// identical to FhishExecutor.sol / fhish-engine
export const OPCODES: Record<number, string> = {
  1: "add",
  2: "sub",
  3: "mul",
  6: "and",
  7: "or",
  8: "xor",
  9: "shl",
  10: "shr",
  13: "eq",
  14: "ne",
  15: "ge",
  16: "gt",
  17: "le",
  18: "lt",
  19: "min",
  20: "max",
  22: "not",
};

async function bumpOp(ctx: Ctx, chainId: number, name: string, opcode: number | undefined, scalar: boolean, block: number) {
  const id = `${chainId}-${name}`;
  const cur = await ctx.FheOpStat.get(id);
  const next: FheOpStat = {
    id,
    chainId,
    name,
    opcode,
    count: (cur?.count ?? 0) + 1,
    scalarCount: (cur?.scalarCount ?? 0) + (scalar ? 1 : 0),
    lastBlock: block,
  };
  ctx.FheOpStat.set(next);
}

async function bumpCaller(ctx: Ctx, chainId: number, caller: string, kind: "ops" | "selects" | "inputsVerified", block: number) {
  const c = lc(caller);
  const id = `${chainId}-${c}`;
  const cur: FheCallerStat = (await ctx.FheCallerStat.get(id)) ?? { id, chainId, caller: c, label: tokenLabel(c) ?? "app", ops: 0, selects: 0, inputsVerified: 0, lastBlock: 0 };
  ctx.FheCallerStat.set({ ...cur, [kind]: cur[kind] + 1, lastBlock: block });
}

async function bumpTotals(u: Unit, field?: "fheSelects" | "fheInputsVerified" | "fheTrivialEncrypts" | "fheRands") {
  const g = await u.global();
  g.fheOps += 1;
  if (field) g[field] += 1;
  (await u.day()).fheOps += 1;
  u.flush();
}

indexer.onEvent({ contract: "FhishExecutor", event: "FheOp" }, async ({ event, context }) => {
  const op = Number(event.params.op);
  await bumpOp(context, event.chainId, OPCODES[op] ?? `op${op}`, op, event.params.scalar, event.block.number);
  await bumpCaller(context, event.chainId, event.params.caller, "ops", event.block.number);
  await bumpTotals(new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x"));
});

indexer.onEvent({ contract: "FhishExecutor", event: "FheSelect" }, async ({ event, context }) => {
  await bumpOp(context, event.chainId, "select", undefined, false, event.block.number);
  await bumpCaller(context, event.chainId, event.params.caller, "selects", event.block.number);
  await bumpTotals(new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x"), "fheSelects");
});

indexer.onEvent({ contract: "FhishExecutor", event: "VerifyInput" }, async ({ event, context }) => {
  await bumpOp(context, event.chainId, "verifyInput", undefined, false, event.block.number);
  await bumpCaller(context, event.chainId, event.params.caller, "inputsVerified", event.block.number);
  await bumpTotals(new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x"), "fheInputsVerified");
});

indexer.onEvent({ contract: "FhishExecutor", event: "TrivialEncrypt" }, async ({ event, context }) => {
  await bumpOp(context, event.chainId, "trivialEncrypt", undefined, false, event.block.number);
  await bumpTotals(new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x"), "fheTrivialEncrypts");
});

indexer.onEvent({ contract: "FhishExecutor", event: "Rand" }, async ({ event, context }) => {
  await bumpOp(context, event.chainId, "rand", undefined, false, event.block.number);
  await bumpTotals(new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x"), "fheRands");
});
