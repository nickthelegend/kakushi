// Live Monad heartbeat: real Monad testnet blocks moving through commit states, straight from the
// `monadNewHeads` WebSocket subscription (read-only).
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { C, F, R, S } from "./theme";
import { T, Row, Card } from "./kit";
import { COMMIT_STATES, type CommitState, type MonadHeads } from "../lib/monad";
import { fmtMs } from "./Ladder";

interface B {
  n: bigint;
  state: CommitState;
  at: Partial<Record<CommitState, number>>;
}

const COLORS: Record<CommitState, string> = {
  Proposed: "rgba(52,227,255,0.22)",
  Voted: "rgba(52,227,255,0.5)",
  Finalized: C.biolum,
  Verified: "#c9fbff",
};

export function Heartbeat({ heads }: { heads: MonadHeads }) {
  const [blocks, setBlocks] = useState<B[]>([]);
  const [status, setStatus] = useState(heads.status);
  useEffect(() => {
    const prev = heads.onStatus;
    heads.onStatus = (s) => setStatus(s);
    heads.start();
    const off = heads.on((h) => {
      setBlocks((bs) => {
        const out = bs.slice();
        let b = out.find((x) => x.n === h.number);
        if (!b) {
          b = { n: h.number, state: h.state, at: {} };
          out.push(b);
          out.sort((x, y) => (x.n < y.n ? -1 : 1));
        } else if (COMMIT_STATES.indexOf(h.state) > COMMIT_STATES.indexOf(b.state)) {
          b = { ...b, state: h.state };
          out[out.findIndex((x) => x.n === h.number)] = b;
        }
        if (b.at[h.state] === undefined) b.at = { ...b.at, [h.state]: h.t };
        return out.slice(-14);
      });
    });
    return () => {
      off();
      heads.onStatus = prev;
    };
  }, [heads]);

  const done = blocks.filter((b) => b.at.Proposed !== undefined && b.at.Finalized !== undefined);
  const fin = done.map((b) => b.at.Finalized! - b.at.Proposed!).sort((a, b) => a - b);
  const median = fin.length ? fin[Math.floor(fin.length / 2)]! : null;
  const voted = blocks.filter((b) => b.at.Proposed !== undefined && b.at.Voted !== undefined).map((b) => b.at.Voted! - b.at.Proposed!).sort((a, b) => a - b);
  const vmed = voted.length ? voted[Math.floor(voted.length / 2)]! : null;
  const head = blocks.at(-1);

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Row gap={8}>
          <View style={[h.live, { backgroundColor: status === "live" ? C.ok : status === "connecting" ? C.lantern : C.danger }]} />
          <T kind="label">Monad testnet · live</T>
        </Row>
        <T style={h.num}>{head ? `#${head.n.toString()}` : status === "error" ? "offline" : "connecting…"}</T>
      </Row>
      <View style={h.bars}>
        {Array.from({ length: 14 }).map((_, i) => {
          const b = blocks[blocks.length - 14 + i];
          const idx = b ? COMMIT_STATES.indexOf(b.state) : -1;
          return <View key={b ? b.n.toString() : `e${i}`} style={[h.bar, { height: 10 + idx * 9, backgroundColor: b ? COLORS[b.state] : "rgba(156,188,191,0.08)" }]} />;
        })}
      </View>
      <Row style={{ justifyContent: "space-between" }}>
        <Legend />
        <T kind="small" style={{ fontFamily: F.mono }}>
          {vmed !== null ? `voted ${fmtMs(vmed)}` : ""}
          {median !== null ? ` · final ${fmtMs(median)}` : ""}
        </T>
      </Row>
    </Card>
  );
}

function Legend() {
  return (
    <Row gap={8}>
      {(["Proposed", "Voted", "Finalized", "Verified"] as const).map((s) => (
        <Row key={s} gap={3}>
          <View style={[h.key, { backgroundColor: COLORS[s] }]} />
          <T kind="small" style={{ fontSize: 10 }}>{s[0]}</T>
        </Row>
      ))}
    </Row>
  );
}

const h = StyleSheet.create({
  live: { width: 7, height: 7, borderRadius: 4 },
  num: { fontFamily: F.monoMed, fontSize: 12, color: C.mist },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 46, marginVertical: S.md },
  bar: { flex: 1, borderRadius: R.sm / 3 },
  key: { width: 8, height: 8, borderRadius: 2 },
});
