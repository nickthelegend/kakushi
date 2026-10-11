import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, S } from "../ui/theme";
import { T, Button, Card, Gap, Notice, Row, Segmented, Chip } from "../ui/kit";
import { useApp } from "../state/AppState";
import { passkeyEnv, passkeySupport } from "../state/passkeyEnv";
import { describeError } from "../lib/pay";
import { NETWORKS, type NetworkId } from "../lib/config";
import { DEV_KEYS, type DevName } from "../lib/wallet";

/** Create (or restore) the account: Mera passkey, or a DEV key on the local fork. */
export function AccountSetup({ compact }: { compact?: boolean }) {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const support = passkeySupport();
  const go = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(passkeyError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View>
      <Button
        testID="create-passkey"
        title="Create account with a passkey"
        busy={busy === "create"}
        disabled={!support.ok || !!busy}
        onPress={go("create", () => app.createPasskey(`Kakushi Pay ${new Date().toISOString().slice(0, 10)}`))}
      />
      <Gap h={S.sm} />
      <Button kind="secondary" title="I already have one: restore" busy={busy === "restore"} disabled={!support.ok || !!busy} onPress={go("restore", () => app.restorePasskey())} />
      {!compact ? (
        <T kind="small" style={{ marginTop: S.md, textAlign: "center" }}>
          Face ID / Touch ID creates your account. No seed phrase, nothing stored on a server: the same passkey brings back the same account on any device. Powered by Mera.
        </T>
      ) : null}
      {support.why ? (
        <>
          <Gap h={S.md} />
          <Notice tone={support.ok ? "warn" : "info"} title={support.ok ? "Passkey domain" : "Passkeys unavailable in this build"}>
            {support.why}
          </Notice>
        </>
      ) : null}
      {err ? (
        <>
          <Gap h={S.md} />
          <Notice tone="error">{err}</Notice>
        </>
      ) : null}
      {app.net.dev ? (
        <>
          <Gap h={S.lg} />
          <View style={o.dev}>
            <Row style={{ justifyContent: "space-between", marginBottom: S.sm }}>
              <T kind="label" style={{ color: C.lantern }}>DEV only · local fork</T>
              <Chip tone="lantern" text="public anvil keys" />
            </Row>
            <T kind="small" style={{ marginBottom: S.md }}>
              Test the payment flow where passkeys cannot run (no associated domain on localhost). Never shown on Monad testnet.
            </T>
            <Row gap={S.sm}>
              {(Object.keys(DEV_KEYS) as DevName[])
                .filter((n) => n !== "carol")
                .map((n) => (
                  <Button key={n} testID={`dev-${n}`} kind="secondary" style={{ flex: 1, minHeight: 44 }} title={`DEV ${n}`} busy={busy === n} disabled={!!busy} onPress={go(n, () => app.useDevAccount(n))} />
                ))}
            </Row>
          </View>
        </>
      ) : null}
    </View>
  );
}

export function passkeyError(e: unknown): string {
  const err = e as { code?: string; cause?: { error?: string; message?: string } };
  if (err?.code === "PRF_UNAVAILABLE") return "This passkey provider does not support the WebAuthn PRF extension (iOS 18+, Google Password Manager or 1Password on Android).";
  if (err?.code === "PASSKEY_OPERATION_FAILED") {
    if (err.cause?.error === "UserCancelled") return "Cancelled.";
    if (err.cause?.error === "RequestFailed") return `The platform refused a passkey for ${passkeyEnv.rpId}. The domain must serve apple-app-site-association / assetlinks.json naming this app (README: Passkey domain).`;
    if (err.cause?.error === "NoCredentials") return "No passkey for this account reached this device. Create one, or check iCloud Keychain / your password manager sync.";
    return err.cause?.message ?? "The passkey request failed.";
  }
  return describeError(e);
}

export function Onboarding() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: S.xl, paddingTop: insets.top + S.xxl, paddingBottom: insets.bottom + S.xl }}>
      <Image source={require("../../assets/kakushi-fin.png")} style={o.logo} />
      <Gap h={S.xl} />
      <T kind="label" style={{ color: C.biolum }}>Kakushi Pay · Agora AUSD on Monad</T>
      <Gap h={S.sm} />
      <T kind="hero">Send dollars across borders. Privately.</T>
      <Gap h={S.md} />
      <T kind="dim">
        Every amount you send and every balance you hold is encrypted on-chain with FHE. Only you can reveal your number. Settles in under a second.
      </T>
      {app.pendingClaim ? (
        <>
          <Gap h={S.lg} />
          <Card glow>
            <T kind="label" style={{ color: C.biolum }}>Someone sent you money</T>
            <Gap h={S.xs} />
            <T kind="body">Create your account to claim pay link #{app.pendingClaim.id.toString()}. The amount stays encrypted until you open it.</T>
          </Card>
        </>
      ) : null}
      <Gap h={S.xl} />
      <AccountSetup />
      <Gap h={S.xl} />
      <T kind="label" style={{ marginBottom: S.sm }}>Network</T>
      <Segmented<NetworkId>
        value={app.network}
        onChange={app.setNetwork}
        options={(Object.keys(NETWORKS) as NetworkId[]).map((n) => ({ value: n, label: NETWORKS[n].label }))}
      />
      {!app.ctx ? (
        <>
          <Gap h={S.sm} />
          <Notice tone="warn">{`Kakushi Pay is not deployed on ${app.net.label} yet. Use the local fork.`}</Notice>
        </>
      ) : null}
      <T kind="small" style={{ marginTop: S.lg, textAlign: "center", fontFamily: F.mono }}>
        passkey domain · {passkeyEnv.rpId}
      </T>
    </ScrollView>
  );
}

const o = StyleSheet.create({
  logo: { width: 64, height: 64, borderRadius: 16 },
  dev: { borderWidth: 1, borderStyle: "dashed", borderColor: C.lantern + "66", borderRadius: 16, padding: S.lg, backgroundColor: C.lanternDim },
});
