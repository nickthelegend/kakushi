// The settlement ladder shown after every transaction: how settled a payment is, in milliseconds.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { C, F, S } from "./theme";
import { T, Row, Chip } from "./kit";
import type { CommitState } from "../lib/monad";

export interface Step {
  key: string;
  label: string;
  hint?: string;
  ms?: number;
  state: "todo" | "active" | "done" | "error";
}

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <View>
      {steps.map((s, i) => (
        <StepRow key={s.key} step={s} last={i === steps.length - 1} />
      ))}
    </View>
  );
}

function StepRow({ step, last }: { step: Step; last: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (step.state !== "active") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 520, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [step.state, pulse]);
  const color = step.state === "done" ? C.biolum : step.state === "error" ? C.danger : step.state === "active" ? C.foam : C.faint;
  return (
    <View style={l.row}>
      <View style={l.rail}>
        <Animated.View style={[l.dot, { borderColor: color, backgroundColor: step.state === "done" ? C.biolum : "transparent", opacity: step.state === "active" ? pulse : 1 }]} />
        {!last ? <View style={[l.line, { backgroundColor: step.state === "done" ? C.biolum + "66" : C.line }]} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : S.md }}>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="body" style={{ color: step.state === "todo" ? C.faint : C.foam, fontFamily: F.sansMed }}>
            {step.label}
          </T>
          {step.ms !== undefined ? <T style={l.ms}>{fmtMs(step.ms)}</T> : null}
        </Row>
        {step.hint ? (
          <T kind="small" style={{ color: step.state === "error" ? C.danger : C.faint }}>
            {step.hint}
          </T>
        ) : null}
      </View>
    </View>
  );
}

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);

/** Proposed -> Voted -> Finalized (-> Verified) for one block. */
export function SettlementLadder({ at, verified, sync, includedMs, block }: { at: Partial<Record<CommitState, number>>; verified: boolean; sync?: boolean; includedMs?: number; block?: bigint }) {
  const states: CommitState[] = verified ? ["Proposed", "Voted", "Finalized", "Verified"] : ["Proposed", "Voted", "Finalized"];
  const hints: Record<CommitState, string> = {
    Proposed: "block proposed by the leader",
    Voted: "a supermajority voted (MonadBFT)",
    Finalized: "irreversible",
    Verified: "state root verified",
  };
  const firstTodo = states.findIndex((s) => at[s] === undefined);
  return (
    <View>
      <Row style={{ justifyContent: "space-between", marginBottom: S.md }}>
        <T kind="label">Settlement{block !== undefined ? ` · block ${block.toLocaleString?.() ?? block}` : ""}</T>
        {sync !== undefined ? <Chip tone={sync ? "cipher" : "neutral"} text={sync ? "sendRawTransactionSync" : "polled receipt"} /> : null}
      </Row>
      <StepList
        steps={[
          ...(includedMs !== undefined ? [{ key: "rc", label: "Receipt", hint: sync ? "one round trip: signed tx in, receipt out" : "submitted, receipt polled", ms: includedMs, state: "done" as const }] : []),
          ...states.map((s, i) => ({
            key: s,
            label: s,
            hint: hints[s],
            ms: at[s],
            state: at[s] !== undefined ? ("done" as const) : i === firstTodo ? ("active" as const) : ("todo" as const),
          })),
        ]}
      />
    </View>
  );
}

const l = StyleSheet.create({
  row: { flexDirection: "row", gap: S.md },
  rail: { width: 14, alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 5 },
  line: { width: 2, flex: 1, marginTop: 3, borderRadius: 1 },
  ms: { fontFamily: F.monoMed, fontSize: 13, color: C.biolum },
});
