// "Request money": ask someone (anywhere) for an encrypted amount, and the request's own screen for
// both sides. The payer reveals what is asked and pays it with one call; the payee reveals what is
// still owed and can cancel. Nobody else can read the amount, or even whether it was paid.
import React, { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { isAddress } from "viem";
import { C, F, R, S } from "../ui/theme";
import { T, Button, Card, Cipher, Field, Gap, Notice, Row, Segmented, Chip } from "../ui/kit";
import { Screen, useNav } from "../ui/Screen";
import { StepList, SettlementLadder, fmtMs } from "../ui/Ladder";
import { useApp } from "../state/AppState";
import { useFlow } from "../ui/useFlow";
import { AccountSetup } from "./Onboarding";
import {
  cancelRequest,
  describeError,
  formatAusd,
  memoMatches,
  parseAusd,
  payRequest,
  requestInfo,
  requestPayment,
  requestRef,
  reveal,
  shortHex,
  type RequestInfo,
} from "../lib/pay";
import { requestUrls, type ParsedRequestLink } from "../lib/links";
import { NETWORKS } from "../lib/config";
import type { Hex } from "../lib/bytes";

const EXPIRY = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;

const fmtDate = (sec: bigint) => new Date(Number(sec) * 1000).toLocaleDateString();

// ------------------------------------------------------------------ create a request (payee)

export function Request() {
  const app = useApp();
  const nav = useNav();
  const flow = useFlow();
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<"1" | "7" | "30">("7");
  const [formErr, setFormErr] = useState<{ amount?: string; payer?: string; memo?: string }>({});
  const [handle, setHandle] = useState<Hex | null>(null);
  const [made, setMade] = useState<{ id: bigint; block: bigint; expiry: bigint; memo: string; amount: bigint; payer: Hex } | null>(null);
  const [copied, setCopied] = useState(false);
  const ctx = app.ctx!;

  const submit = () => {
    const errs: typeof formErr = {};
    let v = 0n;
    try {
      v = parseAusd(amount);
    } catch (e) {
      errs.amount = (e as Error).message;
    }
    const who = payer.trim();
    if (!isAddress(who)) errs.payer = "Enter the payer's 0x… address";
    else if (app.address && who.toLowerCase() === app.address.toLowerCase()) errs.payer = "That is your own address: ask someone else";
    if (memo.trim().length > 60) errs.memo = "Keep the reference under 60 characters";
    setFormErr(errs);
    if (errs.amount || errs.payer || errs.memo) return;
    setHandle(null);
    setMade(null);
    flow.run(async () => {
      flow.begin([
        { key: "enc", label: "Encrypt on this phone", hint: "tfhe 1.8.1 (FHE) in the on-device encryptor; the amount never leaves in plaintext" },
        { key: "att", label: "Gateway attests the ciphertext", hint: "proof binds it to this contract and your address" },
        { key: "send", label: "Sign & post the request", hint: "only you and the payer will be able to read the amount" },
      ]);
      flow.step("enc", { state: "active" });
      await app.withSigner(async (w) => {
        const r = await requestPayment(ctx, w.account, who as Hex, v, memo, Number(days) * 86400, {
          encrypted: (e) => {
            flow.step("enc", { state: "done", ms: e.ms.encrypt });
            flow.step("att", { state: "done", ms: e.ms.attest, hint: `handle ${shortHex(e.handle, 6)}` });
            flow.step("send", { state: "active" });
            setHandle(e.handle);
          },
        });
        flow.step("send", { state: "done", ms: r.tx.ms, hint: `request #${r.id} · ${r.tx.sync ? "receipt in one round trip" : "receipt polled"} · gas limit ${r.tx.gasLimit} (estimate × 1.3)` });
        setMade({ id: r.id, block: r.tx.blockNumber, expiry: r.expiry, memo: memo.trim(), amount: v, payer: who as Hex });
        await flow.track(r.tx);
      });
    });
  };

  const urls = made ? requestUrls(app.network, made.id, made.block, made.memo) : null;
  const share = async () => {
    if (!urls || !made) return;
    await Share.share({
      message: `I sent you a payment request${made.memo ? ` for "${made.memo}"` : ""} with Kakushi Confidential. The amount is encrypted: only you can see it once you open the request.\n${urls.web}\n\nIn the app: ${urls.app}`,
    });
  };

  return (
    <Screen title="Request money" back>
      <T kind="dim">Ask someone, anywhere, for AUSD. The amount is encrypted on this phone: only you and the payer can ever read it. They pay with one tap.</T>
      <Gap h={S.lg} />
      <Card glow>
        <T kind="label">Amount</T>
        <Row style={{ alignItems: "flex-end" }}>
          <T style={s.dollar}>$</T>
          <TextInput
            testID="request-amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.faint}
            keyboardType="decimal-pad"
            style={s.amount}
            accessibilityLabel="Amount to request in AUSD"
          />
          <T kind="mono" style={{ marginBottom: 12 }}>
            AUSD
          </T>
        </Row>
        {formErr.amount ? <T kind="small" style={{ color: C.danger }}>{formErr.amount}</T> : <T kind="small">encrypted before it leaves this phone · the chain sees only a handle</T>}
      </Card>
      <Gap h={S.md} />
      <T kind="label" style={{ marginBottom: 6 }}>
        Who pays
      </T>
      <Row style={{ alignItems: "flex-start" }}>
        <Field testID="request-payer" placeholder="0x… address" value={payer} onChangeText={setPayer} error={formErr.payer} style={{ flex: 1 }} />
        <Button
          kind="secondary"
          title="Paste"
          style={{ minHeight: 50, paddingHorizontal: S.lg }}
          onPress={async () => {
            const t = (await Clipboard.getStringAsync()).trim();
            const m = t.match(/0x[0-9a-fA-F]{40}/);
            setPayer(m ? m[0] : t);
          }}
        />
      </Row>
      <Gap h={S.md} />
      <Field testID="request-memo" label="What for (optional)" placeholder="rent october" value={memo} onChangeText={setMemo} error={formErr.memo} hint="on-chain only as a hash; the words travel in your request link" />
      <Gap h={S.md} />
      <T kind="label" style={{ marginBottom: 6 }}>
        Request expires in
      </T>
      <Segmented value={days} onChange={setDays} options={EXPIRY.map((e) => ({ value: e.value, label: e.label }))} />
      <Gap h={S.lg} />
      <Button testID="request-submit" title="Encrypt & request" busy={flow.busy} onPress={submit} disabled={!app.ctx} />

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

      {made && urls ? (
        <>
          <Gap h={S.md} />
          <Card glow>
            <Row style={{ justifyContent: "space-between" }}>
              <T kind="h2">Request #{made.id.toString()}</T>
              <Chip tone="cipher" text={`expires ${fmtDate(made.expiry)}`} />
            </Row>
            <Gap h={S.sm} />
            <T kind="dim">
              {`Asked ${shortHex(made.payer, 5)}${made.memo ? ` for "${made.memo}"` : ""}. Send them this link; it holds no secret, so it is safe in any chat. Only they can pay it.`}
            </T>
            <Gap h={S.sm} />
            <T kind="mono" testID="request-link">
              {urls.web}
            </T>
            <Gap h={S.md} />
            <Row gap={S.sm}>
              <Button testID="share-request" title="Share" style={{ flex: 1 }} onPress={share} />
              <Button
                kind="secondary"
                title={copied ? "Copied" : "Copy"}
                style={{ flex: 1 }}
                onPress={async () => {
                  await Clipboard.setStringAsync(urls.web);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
            </Row>
            <Gap h={S.sm} />
            <Button kind="ghost" title="Open request" onPress={() => nav.go({ name: "request-detail", link: { net: app.network, id: made.id, block: made.block, memo: made.memo || undefined } })} />
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

// ------------------------------------------------------------------ one request (payer or payee)

// payRequest is all-or-nothing: it moves exactly what is owed, or (balance short) nothing at all
type Outcome = { kind: "settled" } | { kind: "short"; owed: bigint };

export function RequestDetail({ link }: { link: ParsedRequestLink }) {
  const app = useApp();
  const flow = useFlow();
  const ctx = app.ctx;
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [memoOk, setMemoOk] = useState<boolean | null>(null);
  const [owed, setOwed] = useState<{ handle: Hex; value: bigint } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);

  // a request link names its network; follow it
  useEffect(() => {
    if (link.net !== app.network) app.setNetwork(link.net);
  }, [link, app]);

  const load = useCallback(async () => {
    if (!ctx || link.net !== app.network) return null;
    try {
      const i = await requestInfo(ctx, link.id);
      setInfo(i);
      setInfoErr(null);
      return i;
    } catch (e) {
      setInfoErr(describeError(e));
      return null;
    }
  }, [ctx, link, app.network]);

  useEffect(() => {
    load();
  }, [load, app.version]);

  // the memo in the link is only shown as "verified" if its hash is the reference committed on-chain
  useEffect(() => {
    if (!ctx || link.net !== app.network || !link.memo || link.block === undefined) return;
    requestRef(ctx, link.id, link.block)
      .then((ref) => setMemoOk(ref ? memoMatches(link.memo!, ref) : false))
      .catch(() => setMemoOk(null));
  }, [ctx, link, app.network]);

  // a revealed number is valid only for the handle it came from, and hides on lock
  useEffect(() => {
    if (owed && info && owed.handle.toLowerCase() !== info.due.toLowerCase()) setOwed(null);
  }, [info, owed]);
  useEffect(() => {
    if (!app.wallet) setOwed(null);
  }, [app.wallet]);

  const me = app.address?.toLowerCase();
  const role: "payee" | "payer" | "other" | null = !info || !me ? null : info.payee.toLowerCase() === me ? "payee" : info.payer.toLowerCase() === me ? "payer" : "other";
  const open = info?.status === "Open" && !cancelled;
  // the contract keeps a request "open" forever; only its two parties can tell it is settled (owed 0)
  const settled = !!owed && owed.value === 0n && !!info && owed.handle.toLowerCase() === info.due.toLowerCase();

  const doReveal = async () => {
    if (!ctx || !info) return;
    setRevealing(true);
    setRevealErr(null);
    try {
      const handle = info.due;
      const value = await app.withSigner((w) => reveal(ctx, w.account, handle));
      setOwed({ handle, value });
    } catch (e) {
      setRevealErr(describeError(e));
    } finally {
      setRevealing(false);
    }
  };

  const pay = () =>
    flow.run(async () => {
      if (!ctx || !info) return;
      setOutcome(null);
      flow.begin([
        { key: "pay", label: "Sign & pay from your private balance", hint: "the amount owed moves encrypted; your account pays the gas" },
        { key: "check", label: "Reveal what is still owed", hint: "only you and the requester can read it" },
      ]);
      flow.step("pay", { state: "active" });
      await app.withSigner(async (w) => {
        const r = await payRequest(ctx, w.account, info.id);
        flow.step("pay", { state: "done", ms: r.tx.ms, hint: `${r.tx.sync ? "receipt in one round trip" : "receipt polled"} · gas limit ${r.tx.gasLimit} (estimate × 1.3)` });
        await flow.track(r.tx);
        flow.step("check", { state: "active" });
        const t0 = Date.now();
        const after = await requestInfo(ctx, info.id);
        setInfo(after);
        const left = await reveal(ctx, w.account, after.due);
        setOwed({ handle: after.due, value: left });
        flow.step("check", { state: "done", ms: Date.now() - t0, hint: left === 0n ? "nothing owed" : `still owed ${formatAusd(left)}` });
        setOutcome(left === 0n ? { kind: "settled" } : { kind: "short", owed: left });
      });
    });

  const cancel = () =>
    flow.run(async () => {
      if (!ctx || !info) return;
      flow.begin([{ key: "cancel", label: "Sign & cancel the request", hint: "the payer can no longer pay it" }]);
      flow.step("cancel", { state: "active" });
      await app.withSigner(async (w) => {
        const tx = await cancelRequest(ctx, w.account, info.id);
        flow.step("cancel", { state: "done", ms: tx.ms, hint: `${tx.sync ? "receipt in one round trip" : "receipt polled"}` });
        setCancelled(true);
        await flow.track(tx);
      });
      await load();
    });

  const urls = requestUrls(link.net, link.id, link.block, link.memo);
  const statusChip = !info ? null : cancelled || info.status === "Cancelled" ? <Chip tone="danger" text="cancelled" /> : info.status === "Expired" ? <Chip tone="danger" text="expired" /> : settled ? <Chip tone="ok" text="settled · only you two know" /> : info.status === "Open" ? <Chip tone="ok" text="open" /> : <Chip tone="danger" text="not found" />;

  return (
    <Screen title={`Request #${link.id}`} back>
      <Card glow>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="label">{settled ? "Nothing owed" : role === "payee" ? (owed ? "Still owed to you" : "You requested") : role === "payer" ? (owed ? "You owe" : "You've been asked for") : "Payment request"}</T>
          <Chip text={NETWORKS[link.net].label} />
        </Row>
        <Gap h={S.sm} />
        {owed ? (
          <>
            <T kind="revealed" testID="request-owed">
              ${formatAusd(owed.value)}
            </T>
            <T kind="small">{owed.value === 0n ? "settled · nothing is owed on this request" : "revealed only to you · nobody else can read it"}</T>
          </>
        ) : (
          <>
            <Cipher value={info && info.status !== "None" ? shortHex(info.due, 10) : "encrypted amount"} size={17} />
            <T kind="small" style={{ marginTop: 4 }}>
              {role === "other" ? "Only the two people on this request can read the amount." : "The amount is encrypted. Only you and the other side can reveal it."}
            </T>
          </>
        )}
        <Gap h={S.md} />
        {info && info.status !== "None" ? (
          <Row gap={S.sm} style={{ flexWrap: "wrap" }}>
            {statusChip}
            {role !== "payee" ? <Chip text={`from ${shortHex(info.payee)}`} /> : null}
            {role !== "payer" ? <Chip text={`to ${shortHex(info.payer)}`} /> : null}
            <Chip text={`expires ${fmtDate(info.expiry)}`} />
          </Row>
        ) : info ? (
          <Notice tone="error">{`Request #${link.id} does not exist on ${NETWORKS[link.net].label}.`}</Notice>
        ) : infoErr ? (
          <Notice tone="error">{infoErr}</Notice>
        ) : !ctx ? (
          <Notice tone="warn">{`Kakushi Confidential is not deployed on ${NETWORKS[link.net].label} yet.`}</Notice>
        ) : (
          <T kind="small">checking the request…</T>
        )}
        {link.memo ? (
          <View style={s.memo}>
            <T kind="label">For</T>
            <T kind="body" style={{ fontFamily: F.sansMed }}>
              {link.memo}
            </T>
            <T kind="small" style={{ color: memoOk ? C.ok : memoOk === false ? C.danger : C.faint }}>
              {memoOk ? "✓ matches the reference committed on-chain" : memoOk === false ? "does not match the on-chain reference: treat this text with care" : "from the link (not checked against the chain)"}
            </T>
          </View>
        ) : null}
      </Card>
      <Gap h={S.lg} />

      {!app.stored ? (
        <>
          <T kind="h2">Sign in to see this request</T>
          <T kind="dim" style={{ marginTop: 4, marginBottom: S.md }}>
            A request is addressed to one account. Use the passkey of the account it was sent to.
          </T>
          <AccountSetup compact />
        </>
      ) : role === "other" ? (
        <Notice tone="info" title="Not addressed to you">
          {`This request is between ${shortHex(info!.payee)} and ${shortHex(info!.payer)}. You are signed in as ${shortHex(app.address ?? "")}.`}
        </Notice>
      ) : role ? (
        <View style={{ gap: S.sm }}>
          {!owed ? <Button testID="request-reveal" title={role === "payer" ? "Reveal the amount" : "Reveal what's still owed"} busy={revealing} onPress={doReveal} disabled={!info} /> : null}
          {/* the payer sees what they are paying first (and a settled request is not paid twice) */}
          {role === "payer" && open && owed && !settled ? <Button testID="request-pay" title={`Pay $${formatAusd(owed.value)}`} busy={flow.busy} onPress={pay} /> : null}
          {role === "payee" && open && !settled ? <Button testID="request-cancel" kind="danger" title="Cancel request" busy={flow.busy} onPress={cancel} /> : null}
          {role === "payee" && open && !settled ? (
            <Button
              kind="ghost"
              title={copied ? "Link copied" : "Copy request link"}
              onPress={async () => {
                await Clipboard.setStringAsync(urls.web);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          ) : null}
          {role === "payer" && open && !settled ? <T kind="small" style={{ textAlign: "center" }}>{owed ? "Paying sends from your private cAUSD balance. Your account pays the gas." : "Reveal the amount to pay it. Only you and the requester can see it."}</T> : null}
        </View>
      ) : null}
      {revealErr ? (
        <>
          <Gap h={S.sm} />
          <Notice tone="error">{revealErr}</Notice>
        </>
      ) : null}

      {outcome ? (
        <>
          <Gap h={S.md} />
          {outcome.kind === "settled" ? (
            <Notice tone="ok" title="Paid">
              {`Request #${link.id} is settled: nothing is owed. The amount moved encrypted; on-chain it is just another ciphertext.`}
            </Notice>
          ) : (
            <Notice tone="warn" title="Nothing moved, and that's fine">
              {`Your private balance was short of $${formatAusd(outcome.owed)}, so no funds left your account and the request stays open with the same amount owed. Add AUSD, then pay again. Nobody else can tell this happened.`}
            </Notice>
          )}
        </>
      ) : null}

      {flow.steps.length ? (
        <>
          <Gap h={S.lg} />
          <Card>
            <StepList steps={flow.steps} />
            {flow.error ? <Notice tone="error">{flow.error}</Notice> : null}
          </Card>
        </>
      ) : null}
      {flow.ladder ? (
        <>
          <Gap h={S.md} />
          <Card>
            <SettlementLadder at={flow.ladder.at} verified={app.net.settlement === "monadHeads"} sync={flow.ladder.sync} includedMs={flow.ladder.includedMs} block={flow.ladder.block} />
          </Card>
        </>
      ) : null}
      <Gap h={S.md} />
      <T kind="small" style={{ color: C.faint, textAlign: "center" }}>
        Paid or not is private too: the chain only shows that a payment was attempted.
      </T>
    </Screen>
  );
}

const s = StyleSheet.create({
  dollar: { fontFamily: F.display, fontSize: 30, color: C.mist, marginBottom: 8, marginRight: 4 },
  amount: { flex: 1, fontFamily: F.display, fontSize: 40, color: C.foam, paddingVertical: 4 },
  onchain: { marginTop: S.md, padding: S.md, borderRadius: R.sm, backgroundColor: C.trench, gap: 4 },
  memo: { marginTop: S.md, padding: S.md, borderRadius: R.sm, backgroundColor: C.trench, gap: 2 },
});
