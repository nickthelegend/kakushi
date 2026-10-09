import { test } from "node:test";
import assert from "node:assert/strict";
import { OpGraph } from "../src/graph.ts";
import { Metrics } from "../src/metrics.ts";
import type { Engine } from "../src/engine.ts";

// A fake engine: records when each handle starts/finishes; every op takes `ms`.
function fakeEngine(ms = 40) {
  const done = new Set<string>();
  const log: { h: string; start: number; end: number }[] = [];
  const work = async (h: string) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    done.add(h.toLowerCase());
    log.push({ h, start, end: Date.now() });
  };
  const engine = {
    has: async (h: string) => done.has(h.toLowerCase()),
    op: async (_op: number, result: string) => work(result),
    select: async (result: string) => work(result),
    trivial: async (result: string) => work(result),
    alias: async (result: string) => work(result),
    rand: async (result: string) => work(result),
  } as unknown as Engine;
  return { engine, log, at: (h: string) => log.find((l) => l.h === h)! };
}

test("an op waits for its operands; independent ops run concurrently", async () => {
  const { engine, at } = fakeEngine(40);
  const g = new OpGraph(engine, new Metrics(), 4);
  g.submit({ kind: "trivial", result: "0xa", value: 1n, type: 4 });
  g.submit({ kind: "trivial", result: "0xb", value: 2n, type: 4 });
  g.submit({ kind: "op", op: 1, result: "0xc", lhs: "0xa", rhs: "0xb", scalar: false });
  g.submit({ kind: "op", op: 1, result: "0xd", lhs: "0xc", rhs: "0x5", scalar: true });
  await g.waitFor("0xd");
  assert.ok(at("0xc").start >= Math.max(at("0xa").end, at("0xb").end), "c starts after a and b");
  assert.ok(at("0xd").start >= at("0xc").end, "d starts after c (scalar rhs is not a dependency)");
  assert.ok(Math.abs(at("0xa").start - at("0xb").start) < 30, "a and b ran in parallel");
});

test("select depends on control and both branches", async () => {
  const { engine, at } = fakeEngine(20);
  const g = new OpGraph(engine, new Metrics(), 4);
  g.submit({ kind: "select", result: "0xs", control: "0x1", ifTrue: "0x2", ifFalse: "0x3" });
  for (const h of ["0x3", "0x1", "0x2"]) g.submit({ kind: "trivial", result: h, value: 0n, type: 4 });
  await g.waitFor("0xs");
  for (const h of ["0x1", "0x2", "0x3"]) assert.ok(at("0xs").start >= at(h).end);
});

test("the limiter caps concurrent engine calls", async () => {
  const { engine, log } = fakeEngine(30);
  const g = new OpGraph(engine, new Metrics(), 2);
  for (let i = 0; i < 6; i++) g.submit({ kind: "trivial", result: `0x${i}`, value: 0n, type: 4 });
  for (let i = 0; i < 6; i++) await g.waitFor(`0x${i}`);
  for (const l of log) {
    const overlapping = log.filter((o) => o.start < l.end && o.end > l.start).length;
    assert.ok(overlapping <= 2, `at most 2 at once, saw ${overlapping}`);
  }
});

test("duplicate results are computed once (deterministic handles)", async () => {
  const { engine, log } = fakeEngine(5);
  const g = new OpGraph(engine, new Metrics(), 4);
  g.submit({ kind: "trivial", result: "0xA", value: 5n, type: 4 });
  g.submit({ kind: "trivial", result: "0xa", value: 5n, type: 4 });
  await g.waitFor("0xa");
  assert.equal(log.length, 1);
});
