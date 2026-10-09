import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { C, F, R, S } from "../ui/theme";
import { T, Button, Card, Cipher, Gap, Notice, Row, Chip } from "../ui/kit";
import { Screen, AddressChip, useNav, type Route } from "../ui/Screen";
import { Heartbeat } from "../ui/Heartbeat";
import { useApp } from "../state/AppState";
import { useBalances } from "../ui/useBalances";
import { formatAusd, shortHex, ZERO_HANDLE } from "../lib/pay";

export function Home() {
  const app = useApp();
  const nav = useNav();
  const bal = useBalances();
  const b = bal.b;
  const lowGas = b && b.mon === 0n && !app.ctx?.sponsor;

  return (
    <Screen onRefresh={bal.load} refreshing={bal.loading && !b}>
      <Row style={{ justifyContent: "space-between" }}>
        <Row gap={6}>
          {app.address ? <AddressChip address={app.address} /> : null}
          <Chip tone={app.stored?.kind === "dev" ? "lantern" : "cipher"} text={app.stored?.kind === "dev" ? `DEV ${app.stored.name}` : "passkey"} />
        </Row>
        <Chip text={app.net.label} />
      </Row>
      {app.sessionNote ? (
        <>
          <Gap h={S.md} />
          <Notice tone="warn" title="Session ended">
            {app.sessionNote}
          </Notice>
        </>
      ) : null}
      <Gap h={S.lg} />

      <Card glow style={{ padding: S.xl }}>
        <Row style={{ justifyContent: "space-between" }}>
          <T kind="label">Private balance · cAUSD</T>
          <Chip tone={bal.revealed ? "lantern" : "cipher"} text={bal.revealed ? "revealed to you" : "encrypted"} />
        </Row>
        <Gap h={S.md} />
        {bal.revealed ? (
          <Pressable onPress={bal.hide} accessibilityRole="button" accessibilityLabel="Hide balance">
            <T kind="revealed" testID="revealed-balance">
              ${formatAusd(bal.revealed.value)}
            </T>
            <T kind="small">only this device could open it · tap to hide</T>
          </Pressable>
        ) : (
          <View>
            <Cipher value={b ? (b.handle === ZERO_HANDLE ? "0x00 · no private balance yet" : shortHex(b.handle, 10)) : "0x…"} size={17} />
            <T kind="small" style={{ marginTop: 4 }}>
              on-chain this is all anyone sees: a ciphertext handle
            </T>
          </View>
        )}
        <Gap h={S.lg} />
        {!bal.revealed ? <Button testID="reveal" title={app.wallet ? "Reveal" : "Unlock & reveal"} busy={bal.revealing} onPress={bal.doReveal} disabled={!b} /> : null}
        {bal.revealErr ? (
          <>
            <Gap h={S.sm} />
            <Notice tone="error">{bal.revealErr}</Notice>
          </>
        ) : null}
      </Card>

      <Gap h={S.md} />
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <T kind="label">Public AUSD</T>
            <T style={h.pub}>{b ? formatAusd(b.ausd) : "…"}</T>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <T kind="label">Gas · MON</T>
            <T style={[h.pub, { fontSize: 15, color: C.mist }]}>{b ? (Number(b.mon) / 1e18).toFixed(3) : "…"}</T>
          </View>
        </Row>
        {app.ctx?.sponsor ? <T kind="small" style={{ marginTop: S.sm }}>DEV sponsor pays gas for faucet, wraps and link claims on the fork.</T> : null}
        {lowGas ? <Notice tone="warn">{"This account has no MON for gas. Get testnet MON from the Monad faucet."}</Notice> : null}
      </Card>

      <Gap h={S.lg} />
      <View style={h.grid}>
        <Action label="Send" glyph="↗" onPress={() => nav.go({ name: "send" })} primary />
        <Action label="Add AUSD" glyph="+" onPress={() => nav.go({ name: "fund" })} />
        <Action label="Claim link" glyph="⌁" onPress={() => nav.go({ name: "claim" } as Route)} />
        <Action label="Cash out" glyph="↙" onPress={() => nav.go({ name: "cashout" })} />
      </View>

      {bal.err ? (
        <>
          <Gap h={S.md} />
          <Notice tone="error" title={`Cannot reach ${app.net.label}`}>
            {bal.err}
          </Notice>
        </>
      ) : null}

      <Gap h={S.lg} />
      <Heartbeat heads={app.heads} />
    </Screen>
  );
}

function Action({ label, glyph, onPress, primary }: { label: string; glyph: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [h.action, primary && h.actionPrimary, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={label}>
      <T style={{ fontSize: 22, lineHeight: 26, color: primary ? C.abyss : C.biolum }}>{glyph}</T>
      <T style={{ fontFamily: F.sansBold, fontSize: 13, color: primary ? C.abyss : C.foam }}>{label}</T>
    </Pressable>
  );
}

const h = StyleSheet.create({
  pub: { fontFamily: F.display, fontSize: 20, color: C.foam, marginTop: 4 },
  grid: { flexDirection: "row", gap: S.sm },
  action: { flex: 1, alignItems: "center", gap: 6, paddingVertical: S.lg, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  actionPrimary: { backgroundColor: C.biolum, borderColor: C.biolum },
});
