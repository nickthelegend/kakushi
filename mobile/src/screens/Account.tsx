import React, { useEffect, useState } from "react";
import { C, F, S } from "../ui/theme";
import { T, Button, Card, Divider, Gap, Notice, Row, Segmented, Chip } from "../ui/kit";
import { Screen, AddressChip } from "../ui/Screen";
import { useApp } from "../state/AppState";
import { passkeyEnv } from "../state/passkeyEnv";
import { encryptor } from "../fhe/bridge";
import { NETWORKS, SESSION_MINUTES, type NetworkId } from "../lib/config";
import { describeError, shortHex } from "../lib/pay";
import { TFHE_VERSION } from "../fhe/encryptorHtml.generated";

function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 6 }}>
      <T kind="dim">{k}</T>
      {typeof v === "string" ? <T style={{ fontFamily: mono ? F.mono : F.sans, fontSize: 13, color: C.foam, flexShrink: 1, textAlign: "right" }} numberOfLines={1}>{v}</T> : v}
    </Row>
  );
}

export function Account() {
  const app = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, []);
  const s = app.stored;
  return (
    <Screen title="Account">
      <Card>
        <T kind="label">Account</T>
        <Gap h={S.sm} />
        <KV k="Address" v={app.address ? <AddressChip address={app.address} /> : "…"} />
        <KV k="Sign-in" v={s?.kind === "dev" ? `DEV key · ${s.name} (local fork only)` : "Mera passkey"} mono={false} />
        {s?.kind === "passkey" ? <KV k="Credential" v={shortHex(s.credentialId, 6)} /> : null}
        <KV k="Passkey domain" v={passkeyEnv.rpId} />
        <Divider />
        <T kind="label">Signing session</T>
        <Gap h={S.sm} />
        <T kind="dim">
          Your key exists only in memory while a session is open. It is wiped after {SESSION_MINUTES} minutes or when you lock; the next signature asks for your passkey again. Nothing secret is stored on this phone.
        </T>
        <Gap h={S.md} />
        {app.wallet ? (
          <Button kind="secondary" title="Lock now" onPress={() => app.lock("Locked. The key was wiped from memory.")} />
        ) : (
          <Button
            title="Unlock"
            onPress={() => {
              setErr(null);
              app.unlock().catch((e) => setErr(describeError(e)));
            }}
          />
        )}
        {err ? <Notice tone="error">{err}</Notice> : null}
        <Gap h={S.sm} />
        <Button kind="danger" title="Sign out of this device" onPress={() => app.signOut()} />
        <T kind="small" style={{ marginTop: S.sm }}>Signing out forgets the address here. Your passkey (and funds) stay yours: restore with the same passkey on any device.</T>
      </Card>
      <Gap h={S.md} />
      <Card>
        <T kind="label">Network</T>
        <Gap h={S.sm} />
        <Segmented<NetworkId> value={app.network} onChange={app.setNetwork} options={(Object.keys(NETWORKS) as NetworkId[]).map((n) => ({ value: n, label: NETWORKS[n].label }))} />
        <Gap h={S.sm} />
        <KV k="RPC" v={app.net.rpcUrl.replace(/^https?:\/\//, "")} />
        <KV k="Gateway" v={app.net.gatewayUrl ? app.net.gatewayUrl.replace(/^https?:\/\//, "") : "not configured"} />
        <KV k="cAUSD" v={app.net.deployment ? shortHex(app.net.deployment.causd, 6) : "not deployed"} />
        <KV k="AUSD" v={shortHex(app.net.ausd, 6)} />
        <KV k="Settlement" v={app.net.settlement === "monadHeads" ? "monadNewHeads commit states" : "block tags (fork)"} mono={false} />
      </Card>
      <Gap h={S.md} />
      <Card>
        <T kind="label">On-device encryption</T>
        <Gap h={S.sm} />
        <KV k="Engine" v={`tfhe ${TFHE_VERSION} (WASM in WebView)`} mono={false} />
        <KV k="Status" v={<Chip tone={encryptor.ready ? "ok" : encryptor.error ? "danger" : "neutral"} text={encryptor.ready ? `ready in ${encryptor.readyMs} ms` : encryptor.error ?? "starting"} />} />
        <KV k="Last encrypt" v={encryptor.lastEncryptMs !== null ? `${encryptor.lastEncryptMs} ms` : "—"} />
      </Card>
    </Screen>
  );
}
