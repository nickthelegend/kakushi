import React, { useState } from "react";
import { C, S } from "../ui/theme";
import { T, Button, Card, Field, Gap, Notice, Row, Chip } from "../ui/kit";
import { Screen } from "../ui/Screen";
import { StepList, SettlementLadder, fmtMs } from "../ui/Ladder";
import { useApp } from "../state/AppState";
import { useFlow } from "../ui/useFlow";
import { useBalances } from "../ui/useBalances";
import { formatAusd, parseAusd, shortHex, unwrap } from "../lib/pay";
import type { EncryptedInput } from "../lib/fhe";
import type { SentTx } from "../lib/monad";

/** cAUSD -> AUSD. Only the cashed-out amount is ever decrypted, by the KMS, for the oracle callback. */
export function CashOut() {
  const app = useApp();
  const flow = useFlow();
  const bal = useBalances(4000);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [paid, setPaid] = useState<bigint | null>(null);
  const ctx = app.ctx!;

  const go = () => {
    let v: bigint;
    try {
      v = parseAusd(amount);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setPaid(null);
    flow.run(async () => {
      flow.begin([
        { key: "enc", label: "Encrypt the amount on this phone" },
        { key: "tx", label: "Request cash-out", hint: "the balance check runs on ciphertext; nothing is revealed yet" },
        { key: "kms", label: "Threshold decryption + oracle callback", hint: "KMS signers decrypt only this amount; the oracle calls onUnwrapDecrypted" },
        { key: "paid", label: "AUSD paid to you" },
      ]);
      flow.step("enc", { state: "active" });
      let t1 = Date.now();
      const r = await app.withSigner((w) =>
        unwrap(ctx, w.account, v, (stage, info) => {
          if (stage === "encrypted") {
            const e = info as EncryptedInput;
            flow.step("enc", { state: "done", ms: e.ms.encrypt + e.ms.attest, hint: `handle ${shortHex(e.handle, 6)}` });
            flow.step("tx", { state: "active" });
          } else if (stage === "requested") {
            const tx = info as SentTx;
            flow.step("tx", { state: "done", ms: tx.ms });
            flow.step("kms", { state: "active" });
            t1 = Date.now();
            void flow.track(tx);
          }
        }),
      );
      flow.step("kms", { state: "done", ms: Date.now() - t1, hint: `request #${r.requestId} fulfilled` });
      flow.step("paid", { state: "done", hint: `${formatAusd(r.paid)} AUSD (public, as it leaves the private pool)` });
      setPaid(r.paid);
      bal.load();
    });
  };

  return (
    <Screen title="Cash out" back>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="label">Public AUSD now</T>
          <Chip text={bal.b ? formatAusd(bal.b.ausd) : "…"} />
        </Row>
        <Gap h={S.md} />
        <T kind="dim">Move cAUSD back to plain AUSD, ready for an off-ramp. If the amount exceeds your private balance, nothing moves (checked homomorphically).</T>
        <Gap h={S.md} />
        <Field label="Amount (AUSD)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" error={err} placeholder="50" inputStyle={{ fontSize: 20 }} />
        <Gap h={S.md} />
        <Button testID="cashout" title="Cash out" busy={flow.busy} onPress={go} />
      </Card>
      {flow.steps.length ? (
        <>
          <Gap h={S.md} />
          <Card>
            <StepList steps={flow.steps} />
            {flow.error ? <Notice tone="error">{flow.error}</Notice> : null}
            {paid !== null ? (
              <>
                <Gap h={S.md} />
                <T kind="revealed" style={{ fontSize: 28 }}>+${formatAusd(paid)}</T>
                <T kind="small">{paid === 0n ? "0 paid: the request exceeded your private balance" : "AUSD in your public balance"}</T>
              </>
            ) : null}
          </Card>
        </>
      ) : null}
      {flow.ladder ? (
        <>
          <Gap h={S.md} />
          <Card>
            <SettlementLadder at={flow.ladder.at} verified={app.net.settlement === "monadHeads"} sync={flow.ladder.sync} includedMs={flow.ladder.includedMs} block={flow.ladder.block} />
            {flow.ladder.at.Finalized !== undefined ? <T kind="small" style={{ marginTop: S.sm, color: C.mist }}>request final in {fmtMs(flow.ladder.at.Finalized)}</T> : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
