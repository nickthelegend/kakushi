import React, { useState } from "react";
import { C, S } from "../ui/theme";
import { T, Button, Card, Field, Gap, Notice, Row, Chip } from "../ui/kit";
import { Screen } from "../ui/Screen";
import { StepList, SettlementLadder } from "../ui/Ladder";
import { useApp } from "../state/AppState";
import { useBalances } from "../ui/useBalances";
import { useFlow } from "../ui/useFlow";
import { faucet, formatAusd, parseAusd, wrapWithSignature } from "../lib/pay";

/** Get test AUSD from Agora's faucet, then make it private (AUSD -> encrypted cAUSD). */
export function Fund() {
  const app = useApp();
  const bal = useBalances(4000);
  const tap = useFlow();
  const wrap = useFlow();
  const [amount, setAmount] = useState("100");
  const [amtErr, setAmtErr] = useState<string | null>(null);
  const ctx = app.ctx!;

  const getAusd = () =>
    tap.run(async () => {
      tap.begin([{ key: "tx", label: "Agora faucet: 10,000 AUSD", hint: ctx.sponsor ? "DEV sponsor pays the gas" : "your account pays the gas" }]);
      tap.step("tx", { state: "active" });
      const tx = await app.withSigner((w) => faucet(ctx, w.account, w.address));
      tap.step("tx", { state: "done", ms: tx.ms });
      await tap.track(tx);
      bal.load();
    });

  const makePrivate = () => {
    let v: bigint;
    try {
      v = parseAusd(amount);
      setAmtErr(null);
    } catch (e) {
      setAmtErr((e as Error).message);
      return;
    }
    return wrap.run(async () => {
      wrap.begin([
        { key: "sign", label: "Sign ERC-3009 authorization", hint: "ReceiveWithAuthorization · Agora Dollar v1 · no approve tx" },
        { key: "submit", label: ctx.sponsor ? "Sponsor submits" : "Submit", hint: ctx.sponsor ? "gasless for you: anyone may submit a signed authorization" : "your account pays the gas" },
      ]);
      wrap.step("sign", { state: "active" });
      const t0 = Date.now();
      const tx = await app.withSigner((w) => wrapWithSignature(ctx, w.account, v));
      wrap.step("sign", { state: "done" });
      wrap.step("submit", { state: "done", ms: Date.now() - t0, hint: `${tx.sponsored ? "sponsored" : "self-submitted"} · gas limit ${tx.gasLimit} (estimate × 1.3)` });
      await wrap.track(tx);
      bal.load();
    });
  };

  return (
    <Screen title="Add AUSD" back>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="label">Public AUSD</T>
          <Chip text={bal.b ? formatAusd(bal.b.ausd) : "…"} />
        </Row>
        <Gap h={S.md} />
        <T kind="h2">1 · Get test AUSD</T>
        <T kind="dim" style={{ marginTop: 4 }}>
          Agora's testnet faucet sends 10,000 AUSD. It has a 60 s cooldown shared by everyone.
        </T>
        <Gap h={S.md} />
        <Button kind="secondary" title="Get 10,000 test AUSD" busy={tap.busy} onPress={getAusd} />
        {tap.steps.length ? (
          <>
            <Gap h={S.md} />
            <StepList steps={tap.steps} />
          </>
        ) : null}
        {tap.error ? <Notice tone="error">{tap.error}</Notice> : null}
        {tap.ladder ? (
          <>
            <Gap h={S.md} />
            <SettlementLadder at={tap.ladder.at} verified={app.net.settlement === "monadHeads"} sync={tap.ladder.sync} includedMs={tap.ladder.includedMs} block={tap.ladder.block} />
          </>
        ) : null}
      </Card>
      <Gap h={S.md} />
      <Card glow>
        <T kind="h2">2 · Make it private</T>
        <T kind="dim" style={{ marginTop: 4 }}>
          Wrap AUSD 1:1 into cAUSD. From here on, your balance and every amount you send are ciphertext on Monad.
        </T>
        <Gap h={S.md} />
        <Field label="Amount (AUSD)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" error={amtErr} inputStyle={{ fontSize: 20 }} />
        <Gap h={S.md} />
        <Button testID="make-private" title="Sign & make private" busy={wrap.busy} onPress={makePrivate} />
        {wrap.steps.length ? (
          <>
            <Gap h={S.md} />
            <StepList steps={wrap.steps} />
          </>
        ) : null}
        {wrap.error ? <Notice tone="error">{wrap.error}</Notice> : null}
        {wrap.ladder ? (
          <>
            <Gap h={S.md} />
            <SettlementLadder at={wrap.ladder.at} verified={app.net.settlement === "monadHeads"} sync={wrap.ladder.sync} includedMs={wrap.ladder.includedMs} block={wrap.ladder.block} />
            <Gap h={S.sm} />
            <T kind="small" style={{ color: C.mist }}>
              The wrapped amount is public at the AUSD boundary (it leaves your public balance); everything after this is encrypted.
            </T>
          </>
        ) : null}
      </Card>
    </Screen>
  );
}
