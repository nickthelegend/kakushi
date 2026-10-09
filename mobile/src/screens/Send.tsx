import React, { useState } from "react";
import { Share, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { isAddress } from "viem";
import { C, F, R, S } from "../ui/theme";
import { T, Button, Card, Cipher, Field, Gap, Notice, Row, Segmented, Chip } from "../ui/kit";
import { Screen } from "../ui/Screen";
import { StepList, SettlementLadder, fmtMs } from "../ui/Ladder";
import { useApp } from "../state/AppState";
import { useFlow } from "../ui/useFlow";
import { createLink, formatAusd, parseAusd, pay, shortHex } from "../lib/pay";
import { linkUrls } from "../lib/links";
import type { Hex } from "../lib/bytes";

type Mode = "address" | "link";
const EXPIRY = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;

export function Send() {
  const app = useApp();
  const flow = useFlow();
  const [mode, setMode] = useState<Mode>("address");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<"1" | "7" | "30">("7");
  const [formErr, setFormErr] = useState<{ amount?: string; to?: string }>({});
  const [link, setLink] = useState<{ app: string; web: string; id: bigint; expiry: bigint } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentAmt, setSentAmt] = useState<bigint | null>(null);
  const [handle, setHandle] = useState<Hex | null>(null);
  const ctx = app.ctx!;

  const submit = () => {
    const errs: typeof formErr = {};
    let v = 0n;
    try {
      v = parseAusd(amount);
    } catch (e) {
      errs.amount = (e as Error).message;
    }
    if (mode === "address") {
      if (!isAddress(to.trim())) errs.to = "Enter a 0x… address";
      else if (app.address && to.trim().toLowerCase() === app.address.toLowerCase()) errs.to = "That is your own address";
    }
    setFormErr(errs);
    if (errs.amount || errs.to) return;
    setLink(null);
    setHandle(null);
    setSentAmt(v);
    flow.run(async () => {
      flow.begin([
        { key: "enc", label: "Encrypt on this phone", hint: "tfhe 1.8.1 (FHE) in the on-device encryptor; the amount never leaves in plaintext" },
        { key: "att", label: "Gateway attests the ciphertext", hint: "proof binds it to this contract and your address" },
        { key: "send", label: mode === "address" ? "Sign & send" : "Sign & escrow behind a one-time key", hint: "signed with your passkey session" },
      ]);
      flow.step("enc", { state: "active" });
      const hooks = {
        encrypted: (e: { handle: Hex; ms: { encrypt: number; attest: number } }) => {
          flow.step("enc", { state: "done", ms: e.ms.encrypt });
          flow.step("att", { state: "done", ms: e.ms.attest, hint: `handle ${shortHex(e.handle, 6)}` });
          flow.step("send", { state: "active" });
          setHandle(e.handle);
        },
      };
      await app.withSigner(async (w) => {
        if (mode === "address") {
          const r = await pay(ctx, w.account, to.trim() as Hex, v, memo, hooks);
          flow.step("send", { state: "done", ms: r.tx.ms, hint: `${r.tx.sync ? "receipt in one round trip" : "receipt polled"} · gas limit ${r.tx.gasLimit} (estimate × 1.3)` });
          await flow.track(r.tx);
        } else {
          const r = await createLink(ctx, w.account, v, Number(days) * 86400, hooks);
          const urls = linkUrls(app.network, r.link.id, r.link.key);
          setLink({ ...urls, id: r.link.id, expiry: r.link.expiry });
          flow.step("send", { state: "done", ms: r.tx.ms, hint: `link #${r.link.id} · escrowed encrypted` });
          await flow.track(r.tx);
        }
      });
    });
  };

  const masked = (u: string) => u.replace(/#k=0x[0-9a-fA-F]+/, "#k=0x••••••••");
  const shareLink = async () => {
    if (!link) return;
    await Share.share({
      message: `I sent you ${sentAmt !== null ? formatAusd(sentAmt) + " " : ""}AUSD with Fhish Pay. Open this link to claim it (keep it private: whoever has it can claim):\n${link.web}\n\nIn the app: ${link.app}`,
    });
  };

  return (
    <Screen title="Send">
      <Segmented<Mode>
        value={mode}
        onChange={(m) => {
          setMode(m);
          flow.reset();
          setLink(null);
        }}
        options={[
          { value: "address", label: "To an address" },
          { value: "link", label: "By link" },
        ]}
      />
      <Gap h={S.lg} />
      <Card glow>
        <T kind="label">Amount</T>
        <Row style={{ alignItems: "flex-end" }}>
          <T style={s.dollar}>$</T>
          <TextInput
            testID="amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.faint}
            keyboardType="decimal-pad"
            style={s.amount}
            accessibilityLabel="Amount in AUSD"
          />
          <T kind="mono" style={{ marginBottom: 12 }}>
            AUSD
          </T>
        </Row>
        {formErr.amount ? <T kind="small" style={{ color: C.danger }}>{formErr.amount}</T> : <T kind="small">encrypted before it leaves this phone · only you and the recipient can read it</T>}
      </Card>
      <Gap h={S.md} />
      {mode === "address" ? (
        <>
          <Field testID="to" label="Recipient address" placeholder="0x…" value={to} onChangeText={setTo} error={formErr.to} />
          <Gap h={S.md} />
          <Field label="Reference (optional)" placeholder="invoice 2026-10" value={memo} onChangeText={setMemo} hint="stored on-chain only as a hash" />
        </>
      ) : (
        <Card>
          <T kind="h2">Send to anyone, anywhere</T>
          <T kind="dim" style={{ marginTop: 4 }}>
            For someone without an account yet: the encrypted amount is escrowed behind a one-time key that lives only in the link. They open it, create a passkey account, and claim. Unclaimed links can be refunded after expiry.
          </T>
          <Gap h={S.md} />
          <T kind="label" style={{ marginBottom: 6 }}>Link expires in</T>
          <Segmented value={days} onChange={setDays} options={EXPIRY.map((e) => ({ value: e.value, label: e.label }))} />
        </Card>
      )}
      <Gap h={S.lg} />
      <Button testID="send" title={mode === "address" ? "Encrypt & send" : "Encrypt & create link"} busy={flow.busy} onPress={submit} disabled={!app.ctx} />

      {flow.steps.length ? (
        <>
          <Gap h={S.lg} />
          <Card>
            <StepList steps={flow.steps} />
            {handle ? (
              <View style={s.onchain}>
                <T kind="label">What the chain sees</T>
                <Cipher value={handle} size={12} />
              </View>
            ) : null}
            {flow.error ? <Notice tone="error">{flow.error}</Notice> : null}
          </Card>
        </>
      ) : null}

      {link ? (
        <>
          <Gap h={S.md} />
          <Card glow>
            <Row style={{ justifyContent: "space-between" }}>
              <T kind="h2">Pay link #{link.id.toString()}</T>
              <Chip tone="cipher" text={`expires ${new Date(Number(link.expiry) * 1000).toLocaleDateString()}`} />
            </Row>
            <Gap h={S.sm} />
            <T kind="mono" selectable={false}>
              {masked(link.web)}
            </T>
            <Gap h={S.sm} />
            <Notice tone="warn">Anyone holding this link can claim it. Share it only with the recipient, over a private channel.</Notice>
            <Gap h={S.md} />
            <Row gap={S.sm}>
              <Button testID="share-link" title="Share" style={{ flex: 1 }} onPress={shareLink} />
              <Button
                kind="secondary"
                title={copied ? "Copied" : "Copy"}
                style={{ flex: 1 }}
                onPress={async () => {
                  await Clipboard.setStringAsync(link.web);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
            </Row>
          </Card>
        </>
      ) : null}

      {flow.ladder ? (
        <>
          <Gap h={S.md} />
          <Card>
            <SettlementLadder at={flow.ladder.at} verified={app.net.settlement === "monadHeads"} sync={flow.ladder.sync} includedMs={flow.ladder.includedMs} block={flow.ladder.block} />
            {flow.ladder.at.Finalized !== undefined ? (
              <T kind="small" style={{ marginTop: S.md, color: C.mist }}>
                Final {fmtMs(flow.ladder.at.Finalized)} after submit. tx {shortHex(flow.ladder.hash, 6)}
              </T>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  dollar: { fontFamily: F.display, fontSize: 30, color: C.mist, marginBottom: 8, marginRight: 4 },
  amount: { flex: 1, fontFamily: F.display, fontSize: 40, color: C.foam, paddingVertical: 4 },
  onchain: { marginTop: S.md, padding: S.md, borderRadius: R.sm, backgroundColor: C.trench, gap: 4 },
});
