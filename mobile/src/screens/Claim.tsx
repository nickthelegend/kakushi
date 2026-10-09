import React, { useEffect, useState } from "react";
import { C, S } from "../ui/theme";
import { T, Button, Card, Cipher, Field, Gap, Notice, Row, Chip } from "../ui/kit";
import { Screen } from "../ui/Screen";
import { StepList, SettlementLadder } from "../ui/Ladder";
import { useApp } from "../state/AppState";
import { useFlow } from "../ui/useFlow";
import { useBalances } from "../ui/useBalances";
import { AccountSetup } from "./Onboarding";
import { claimLink, describeError, formatAusd, linkInfo, shortHex } from "../lib/pay";
import { parseLink, type ParsedLink } from "../lib/links";
import { NETWORKS } from "../lib/config";

export function Claim({ link: initial }: { link?: ParsedLink }) {
  const app = useApp();
  const flow = useFlow();
  const bal = useBalances();
  const [link, setLink] = useState<ParsedLink | null>(initial ?? app.pendingClaim);
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState<string | null>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof linkInfo>> | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const ctx = app.ctx;

  // a link names its network; follow it
  useEffect(() => {
    if (link && link.net !== app.network) app.setNetwork(link.net);
  }, [link, app]);

  useEffect(() => {
    if (!link || !ctx || link.net !== app.network) return;
    linkInfo(ctx, link.id)
      .then((i) => {
        setInfo(i);
        setInfoErr(null);
      })
      .catch((e) => setInfoErr(describeError(e)));
  }, [link, ctx, app.network, app.version]);

  const claim = () =>
    flow.run(async () => {
      if (!link || !ctx) return;
      flow.begin([
        { key: "sig", label: "Link key signs your address", hint: "EIP-191 over (contract, chain, link id, you): a front-runner cannot redirect it" },
        { key: "send", label: ctx.sponsor ? "Sponsor submits the claim" : "Submit the claim", hint: ctx.sponsor ? "you need no gas" : "your account pays the gas" },
      ]);
      flow.step("sig", { state: "active" });
      const r = await app.withSigner((w) => claimLink(ctx, w.account, link.id, link.key, w.address));
      flow.step("sig", { state: "done" });
      flow.step("send", { state: "done", ms: r.tx.ms, hint: r.sponsored ? "sponsored: the DEV sponsor paid the gas, not you" : "self-submitted" });
      setClaimed(true);
      app.setPendingClaim(null);
      await flow.track(r.tx);
    });

  if (!link) {
    return (
      <Screen title="Claim a pay link" back>
        <T kind="dim">Paste a Fhish Pay link someone sent you.</T>
        <Gap h={S.md} />
        <Field label="Link" placeholder="https://…/claim?net=…&id=…#k=…" value={paste} onChangeText={setPaste} error={pasteErr} multiline style={{}} inputStyle={{ minHeight: 80, paddingTop: 12 }} />
        <Gap h={S.md} />
        <Button
          title="Open link"
          onPress={() => {
            const p = parseLink(paste);
            if (!p) setPasteErr("That is not a Fhish Pay link.");
            else {
              setPasteErr(null);
              setLink(p);
            }
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={`Pay link #${link.id}`} back>
      <Card glow>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="label">{bal.revealed && claimed ? "Your private balance" : "You've been sent"}</T>
          <Chip text={NETWORKS[link.net].label} />
        </Row>
        <Gap h={S.sm} />
        {bal.revealed && claimed ? (
          <>
            <T kind="revealed">${formatAusd(bal.revealed.value)}</T>
            <T kind="small">includes this link · revealed only to you</T>
          </>
        ) : (
          <>
            <Cipher value={info ? shortHex(info.amount, 10) : "encrypted amount"} size={17} />
            <T kind="small" style={{ marginTop: 4 }}>
              The amount is encrypted. You'll see it after you claim.
            </T>
          </>
        )}
        <Gap h={S.md} />
        {info ? (
          <Row gap={S.sm} style={{ flexWrap: "wrap" }}>
            <Chip tone={info.state === "Open" || claimed ? "ok" : "danger"} text={claimed ? "claimed by you" : info.state === "Open" ? "open" : info.state.toLowerCase()} />
            <Chip text={`from ${shortHex(info.sender)}`} />
            <Chip text={`expires ${new Date(Number(info.expiry) * 1000).toLocaleDateString()}`} />
          </Row>
        ) : infoErr ? (
          <Notice tone="error">{infoErr}</Notice>
        ) : !ctx ? (
          <Notice tone="warn">{`Fhish Pay is not deployed on ${NETWORKS[link.net].label} yet.`}</Notice>
        ) : (
          <T kind="small">checking the link…</T>
        )}
      </Card>
      <Gap h={S.lg} />
      {!app.stored ? (
        <>
          <T kind="h2">Create your account to claim</T>
          <T kind="dim" style={{ marginTop: 4, marginBottom: S.md }}>
            One passkey. No app store wallet, no seed phrase, no gas.
          </T>
          <AccountSetup compact />
        </>
      ) : claimed ? (
        <Button testID="reveal-claimed" title={bal.revealed ? "Revealed" : "Reveal my balance"} busy={bal.revealing} disabled={!!bal.revealed} onPress={bal.doReveal} />
      ) : (
        <Button testID="claim" title={`Claim to ${shortHex(app.address ?? "")}`} busy={flow.busy} disabled={!info || info.state !== "Open"} onPress={claim} />
      )}
      {bal.revealErr ? <Notice tone="error">{bal.revealErr}</Notice> : null}
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
        The link's one-time key stays on this phone. It is never logged or sent anywhere.
      </T>
    </Screen>
  );
}
